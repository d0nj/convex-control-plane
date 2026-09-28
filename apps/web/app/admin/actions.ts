"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth-server";
import { getTeamById, isPlatformAdmin, setTeamSuspended } from "@/lib/teams";

/**
 * Platform-admin server actions (design §4).
 *
 * Suspending a team does not delete anything: it sets `metadata.suspended`,
 * which `POST /api/projects` checks before enqueuing new work. Only platform
 * admins (the admin plugin's `role: "admin"`) may call this; the check is
 * repeated here even though the page hides the controls from everyone else.
 */
export async function setSuspension(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const teamId = String(formData.get("teamId") ?? "");
  const suspend = formData.get("suspend") === "true";

  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  if (!isPlatformAdmin(session.user)) {
    return { error: "Platform admin only." };
  }

  const team = await getTeamById(teamId);
  if (!team) return { error: "Unknown team." };

  await setTeamSuspended(teamId, suspend);
  revalidatePath("/admin");
  return { ok: true };
}
