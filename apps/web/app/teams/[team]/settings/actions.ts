"use server";

import { auth, ForbiddenError } from "@control/auth";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth-server";
import { getTeamById, requireTeamRole } from "@/lib/teams";

/**
 * Team-settings server actions.
 *
 * Membership and invitation operations go through the better-auth organization
 * plugin's server API (not raw SQL) so its rules — last-owner protection, role
 * hierarchy, invitation expiry — stay authoritative. SSO registration is
 * owner-only (design §4). Every action re-checks the caller's role server-side.
 */

/** Require a session and return it, or an error string. */
async function sessionOrError(): Promise<
  { ok: true; userId: string; user: { id: string; role?: string | null } } | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };
  return { ok: true, userId: session.user.id, user: session.user };
}

/** Map a thrown error to a user-facing message without leaking internals. */
function toError(err: unknown, fallback: string): string {
  if (err instanceof ForbiddenError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** The three organization roles; anything else falls back to `member`. */
function asTeamRole(value: string): "member" | "admin" | "owner" {
  return value === "admin" || value === "owner" ? value : "member";
}

/** Invite an email to the team at `role` (admin/owner). */
export async function inviteMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("team") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const role = asTeamRole(String(formData.get("role") ?? "member"));
  if (!email) return { error: "Email is required." };

  const session = await sessionOrError();
  if (!session.ok) return { error: session.error };
  const team = await getTeamById(String(formData.get("teamId") ?? ""));
  if (!team) return { error: "Unknown team." };

  try {
    await requireTeamRole(session.user, team.id, "admin");
    await auth.api.createInvitation({
      headers: await headers(),
      body: { email, role, organizationId: team.id },
    });
  } catch (err) {
    return { error: toError(err, "Could not send the invitation.") };
  }
  revalidatePath(`/teams/${slug}/settings`);
  return { ok: true };
}

/** Cancel a pending invitation (admin/owner). */
export async function cancelInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("team") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");
  const session = await sessionOrError();
  if (!session.ok) return { error: session.error };
  const team = await getTeamById(String(formData.get("teamId") ?? ""));
  if (!team) return { error: "Unknown team." };

  try {
    await requireTeamRole(session.user, team.id, "admin");
    await auth.api.cancelInvitation({
      headers: await headers(),
      body: { invitationId },
    });
  } catch (err) {
    return { error: toError(err, "Could not cancel the invitation.") };
  }
  revalidatePath(`/teams/${slug}/settings`);
  return { ok: true };
}

/** Remove a member (admin/owner). */
export async function removeMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("team") ?? "");
  const memberIdOrEmail = String(formData.get("memberIdOrEmail") ?? "");
  const session = await sessionOrError();
  if (!session.ok) return { error: session.error };
  const team = await getTeamById(String(formData.get("teamId") ?? ""));
  if (!team) return { error: "Unknown team." };

  try {
    await requireTeamRole(session.user, team.id, "admin");
    await auth.api.removeMember({
      headers: await headers(),
      body: { memberIdOrEmail, organizationId: team.id },
    });
  } catch (err) {
    return { error: toError(err, "Could not remove the member.") };
  }
  revalidatePath(`/teams/${slug}/settings`);
  return { ok: true };
}

/** Change a member's role (owner). */
export async function updateMemberRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("team") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const role = asTeamRole(String(formData.get("role") ?? "member"));
  const session = await sessionOrError();
  if (!session.ok) return { error: session.error };
  const team = await getTeamById(String(formData.get("teamId") ?? ""));
  if (!team) return { error: "Unknown team." };

  try {
    await requireTeamRole(session.user, team.id, "owner");
    await auth.api.updateMemberRole({
      headers: await headers(),
      body: { memberId, role, organizationId: team.id },
    });
  } catch (err) {
    return { error: toError(err, "Could not update the role.") };
  }
  revalidatePath(`/teams/${slug}/settings`);
  return { ok: true };
}

/**
 * Register an OIDC SSO provider for the team (owner only, design §4). The
 * provider id is derived from the domain so it is stable and readable.
 */
export async function registerSsoProvider(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("team") ?? "");
  const domain = String(formData.get("domain") ?? "").trim();
  const issuer = String(formData.get("issuer") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();

  if (!domain || !issuer || !clientId) {
    return { error: "Domain, issuer, and client ID are required." };
  }

  const session = await sessionOrError();
  if (!session.ok) return { error: session.error };
  const team = await getTeamById(String(formData.get("teamId") ?? ""));
  if (!team) return { error: "Unknown team." };

  const providerId = `${team.slug}-${domain.replace(/[^a-z0-9]+/gi, "-")}`;

  try {
    await requireTeamRole(session.user, team.id, "owner");
    await auth.api.registerSSOProvider({
      headers: await headers(),
      body: {
        providerId,
        issuer,
        domain,
        organizationId: team.id,
        oidcConfig: {
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
        },
      },
    });
  } catch (err) {
    return { error: toError(err, "Could not register the SSO provider.") };
  }
  revalidatePath(`/teams/${slug}/settings`);
  return { ok: true };
}

/**
 * Danger zone: delete the team (owner). Deletes the organization and, by the
 * schema's cascade, its members and invitations. Projects are NOT touched here
 * — they must be deleted individually from their project pages.
 */
export async function deleteTeam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("team") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== slug) {
    return { error: `Type "${slug}" exactly to confirm.` };
  }

  const session = await sessionOrError();
  if (!session.ok) return { error: session.error };
  const team = await getTeamById(String(formData.get("teamId") ?? ""));
  if (!team) return { error: "Unknown team." };

  try {
    await requireTeamRole(session.user, team.id, "owner");
    await auth.api.deleteOrganization({
      headers: await headers(),
      body: { organizationId: team.id },
    });
  } catch (err) {
    return { error: toError(err, "Could not delete the team.") };
  }
  revalidatePath("/");
  return { ok: true };
}
