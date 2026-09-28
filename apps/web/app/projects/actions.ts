"use server";

import { hasRole } from "@control/auth";
import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth-server";
import { enqueue } from "@/lib/boss";
import { jobKey, type JobOp, type QueueName } from "@/lib/jobs";
import { getProjectBySlug } from "@/lib/projects";
import { getTeamRole, isPlatformAdmin } from "@/lib/teams";
import type { ActionState } from "@/lib/action-state";

/**
 * Project mutation server actions.
 *
 * Every action: requires a session, re-checks the team role on the server (the
 * UI only *hides* buttons — the check that matters is here), and enqueues the
 * matching worker job. Nothing provisions inline (design §3).
 *
 * Role model (design §2): member = read; admin = mutate (create/restart/rotate
 * key/toggle dashboard/update image); owner = delete.
 */

/** Resolve the project and the caller's role, or return an error string. */
async function authorize(
  slug: string,
  required: "admin" | "owner",
): Promise<
  | { ok: true; path: string }
  | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const project = await getProjectBySlug(slug);
  if (!project) return { ok: false, error: `Unknown project "${slug}".` };

  const role = await getTeamRole(session.user.id, project.teamId);
  if (!isPlatformAdmin(session.user) && !hasRole(role, required)) {
    return { ok: false, error: `Requires team role "${required}".` };
  }

  return { ok: true, path: `/projects/${slug}` };
}

/** Enqueue `op` for `slug`, translating infra errors into a user-facing string. */
async function enqueueOp(
  queue: QueueName,
  op: JobOp,
  slug: string,
  data: object,
): Promise<ActionState> {
  try {
    await enqueue(queue, data, jobKey(slug, op));
  } catch (err) {
    console.error(`failed to enqueue ${queue}:`, err);
    return { error: "Could not enqueue the job — is the worker running?" };
  }
  return { ok: true };
}

/** `project.restart` (admin). */
export async function restartProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("slug") ?? "");
  const auth = await authorize(slug, "admin");
  if (!auth.ok) return { error: auth.error };
  const result = await enqueueOp("project.restart", "restart", slug, { slug });
  if (result?.ok) revalidatePath(auth.path);
  return result;
}

/** `project.key-rotate` (admin). */
export async function rotateProjectKey(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("slug") ?? "");
  const auth = await authorize(slug, "admin");
  if (!auth.ok) return { error: auth.error };
  const result = await enqueueOp("project.key-rotate", "key-rotate", slug, {
    slug,
  });
  if (result?.ok) revalidatePath(auth.path);
  return result;
}

/** `project.dashboard-toggle` (admin). */
export async function toggleProjectDashboard(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("slug") ?? "");
  const enabled = formData.get("enabled") === "true";
  const auth = await authorize(slug, "admin");
  if (!auth.ok) return { error: auth.error };
  const result = await enqueueOp(
    "project.dashboard-toggle",
    "dashboard-toggle",
    slug,
    { slug, enabled },
  );
  if (result?.ok) revalidatePath(auth.path);
  return result;
}

/** `project.update` (admin): pull a new backend image and recreate. */
export async function updateProjectImage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("slug") ?? "");
  const backendImage = String(formData.get("backendImage") ?? "").trim();
  const auth = await authorize(slug, "admin");
  if (!auth.ok) return { error: auth.error };
  if (!backendImage) return { error: "Backend image is required." };
  const result = await enqueueOp("project.update", "update", slug, {
    slug,
    backendImage,
  });
  if (result?.ok) revalidatePath(auth.path);
  return result;
}

/**
 * `project.delete` (owner). Destructive, so the user must type the slug to
 * confirm — the check is repeated server-side. `dropDb` is an explicit,
 * separate opt-in (design §3: a plain delete must never destroy data).
 */
export async function deleteProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = String(formData.get("slug") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  const dropDb = formData.get("dropDb") === "on";

  if (confirm !== slug) {
    return { error: `Type "${slug}" exactly to confirm deletion.` };
  }

  const auth = await authorize(slug, "owner");
  if (!auth.ok) return { error: auth.error };

  const result = await enqueueOp("project.delete", "delete", slug, {
    slug,
    dropDb,
  });
  if (result?.ok) revalidatePath(auth.path);
  return result;
}
