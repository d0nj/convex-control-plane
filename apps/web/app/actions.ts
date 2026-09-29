"use server";

import { auth } from "@control/auth";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth-server";

/**
 * Home-page server actions.
 *
 * Team creation goes through the better-auth organization plugin's server API
 * (not raw SQL) so its membership rules stay authoritative. The API requires
 * a slug, so the action derives one from the name when the caller leaves the
 * field blank.
 */

/** Map a thrown error to a user-facing message without leaking internals. */
function toError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * Create a team (organization) for the signed-in caller, who becomes its
 * owner. On success the user lands on the new team's projects page; the
 * redirect itself is the success signal.
 */
export async function createTeam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  if (!name) return { error: "Team name is required." };
  if (slug && !/^[a-z][a-z0-9-]{1,61}$/.test(slug)) {
    return {
      error:
        "Slug must start with a letter and contain only lowercase letters, digits, and dashes (2-62 chars).",
    };
  }

  const session = await getSession();
  if (!session) return { error: "Not signed in." };

  // better-auth's server API requires a slug, so derive one from the name
  // when the caller leaves the field blank.
  const resolvedSlug =
    slug ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 62);
  if (!/^[a-z][a-z0-9-]{1,61}$/.test(resolvedSlug)) {
    return {
      error:
        "Could not derive a valid slug from the name. Enter a slug manually: start with a letter, then lowercase letters, digits, or dashes (2-62 chars).",
    };
  }

  let teamSlug: string;
  try {
    const created = await auth.api.createOrganization({
      headers: await headers(),
      body: { name, slug: resolvedSlug },
    });
    teamSlug = created.slug;
  } catch (err) {
    return { error: toError(err, "Could not create the team.") };
  }
  revalidatePath("/");
  redirect(`/teams/${teamSlug}/projects`);
}
