import { ForbiddenError, hasRole, type TeamRole } from "@control/auth";
import { authSchema, db } from "@control/db";
import { and, eq } from "drizzle-orm";

/**
 * Team (organization) lookups and role resolution for the web app.
 *
 * better-auth's organization plugin is used as the *team* concept (design §2).
 * Routes address a team by its slug (`/teams/[team]/...`); the DB keys members
 * by organization id, so every page first resolves slug -> organization, then
 * the caller's role inside it.
 */

export type Team = typeof authSchema.organization.$inferSelect;

/** Resolve a team by its URL slug, or `null` when it does not exist. */
export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const rows = await db
    .select()
    .from(authSchema.organization)
    .where(eq(authSchema.organization.slug, slug));
  return rows[0] ?? null;
}

/** Resolve a team by its organization id, or `null` when it does not exist. */
export async function getTeamById(id: string): Promise<Team | null> {
  const rows = await db
    .select()
    .from(authSchema.organization)
    .where(eq(authSchema.organization.id, id));
  return rows[0] ?? null;
}

/** The caller's role in a team, or `null` when they are not a member. */
export async function getTeamRole(
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ role: authSchema.member.role })
    .from(authSchema.member)
    .where(
      and(
        eq(authSchema.member.organizationId, organizationId),
        eq(authSchema.member.userId, userId),
      ),
    );
  return rows[0]?.role ?? null;
}

/** True when the user is a platform admin (the admin plugin's `role: "admin"`). */
export function isPlatformAdmin(user: { role?: string | null }): boolean {
  return user.role === "admin";
}

/**
 * Assert the caller may act on a team at `required` level, throwing
 * {@link ForbiddenError} otherwise. Platform admins bypass the team role
 * (design §2), matching `requireRole`'s `platformAdmin` flag.
 */
export async function requireTeamRole(
  user: { id: string; role?: string | null },
  organizationId: string,
  required: TeamRole,
): Promise<TeamRole | null> {
  const role = await getTeamRole(user.id, organizationId);
  if (isPlatformAdmin(user)) return role as TeamRole | null;
  if (!hasRole(role, required)) {
    throw new ForbiddenError(
      `requires team role "${required}" (got ${role ?? "none"})`,
    );
  }
  return role as TeamRole;
}

/**
 * A team is suspended when its `metadata` JSON carries `suspended: true`
 * (set from `/admin`, design §4). Suspended teams keep their data but cannot
 * enqueue new provisioning work.
 */
export function isTeamSuspended(team: Team): boolean {
  if (!team.metadata) return false;
  try {
    const parsed = JSON.parse(team.metadata) as { suspended?: boolean };
    return parsed.suspended === true;
  } catch {
    return false;
  }
}

/** A team membership joined with its organization, for the team switcher. */
export interface TeamMembership {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/** Every team the user belongs to, newest-created first. */
export async function listTeamsForUser(
  userId: string,
): Promise<TeamMembership[]> {
  const rows = await db
    .select({
      id: authSchema.organization.id,
      name: authSchema.organization.name,
      slug: authSchema.organization.slug,
      role: authSchema.member.role,
    })
    .from(authSchema.member)
    .innerJoin(
      authSchema.organization,
      eq(authSchema.member.organizationId, authSchema.organization.id),
    )
    .where(eq(authSchema.member.userId, userId));
  return rows;
}

/** A team member joined with their user record, for the settings page. */
export interface TeamMemberRow {
  memberId: string;
  userId: string;
  role: string;
  email: string;
  name: string;
}

/** Members of a team, with their email/name for display. */
export async function listTeamMembers(
  organizationId: string,
): Promise<TeamMemberRow[]> {
  return db
    .select({
      memberId: authSchema.member.id,
      userId: authSchema.member.userId,
      role: authSchema.member.role,
      email: authSchema.user.email,
      name: authSchema.user.name,
    })
    .from(authSchema.member)
    .innerJoin(authSchema.user, eq(authSchema.member.userId, authSchema.user.id))
    .where(eq(authSchema.member.organizationId, organizationId));
}

/** Pending invitations for a team. */
export async function listTeamInvitations(organizationId: string) {
  return db
    .select()
    .from(authSchema.invitation)
    .where(eq(authSchema.invitation.organizationId, organizationId));
}

/** Every team on the platform (admin page). */
export async function listAllTeams(): Promise<Team[]> {
  return db.select().from(authSchema.organization);
}

/** Count of members in a team, for the admin table. */
export async function countMembers(organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: authSchema.member.id })
    .from(authSchema.member)
    .where(eq(authSchema.member.organizationId, organizationId));
  return rows.length;
}

/**
 * Set a team's suspension flag in its `metadata` JSON. Platform-admin only;
 * the caller checks that. Preserves any other metadata keys.
 */
export async function setTeamSuspended(
  organizationId: string,
  suspended: boolean,
): Promise<void> {
  const team = await getTeamById(organizationId);
  let metadata: Record<string, unknown> = {};
  if (team?.metadata) {
    try {
      metadata = JSON.parse(team.metadata) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }
  metadata.suspended = suspended;
  await db
    .update(authSchema.organization)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(authSchema.organization.id, organizationId));
}
