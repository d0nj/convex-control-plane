import { db, deploymentEvents, projects, projectSecrets } from "@control/db";
import { desc, eq } from "drizzle-orm";

/**
 * Read-only project queries for the web UI.
 *
 * The web app never writes project state directly (except the initial `pending`
 * row on create, in `POST /api/projects`) and never provisions — the worker
 * owns the lifecycle (design §3). Everything here is a plain read.
 */

export type Project = typeof projects.$inferSelect;
export type DeploymentEvent = typeof deploymentEvents.$inferSelect;

/** Every project of a team, newest first. */
export async function listProjects(teamId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(desc(projects.createdAt));
}

/** A project by its global slug, or `null` when it does not exist. */
export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug));
  return rows[0] ?? null;
}

/** The project's most recent deployment events, newest first. */
export async function listEvents(
  projectId: string,
  limit = 50,
): Promise<DeploymentEvent[]> {
  return db
    .select()
    .from(deploymentEvents)
    .where(eq(deploymentEvents.projectId, projectId))
    .orderBy(desc(deploymentEvents.at))
    .limit(limit);
}

/**
 * The stored (encrypted) admin key for a project, or `null` when the worker has
 * not issued one yet. Callers decrypt it server-side with `decryptSecret` and
 * must never send the ciphertext — let alone the plaintext — to the client
 * except inside the rendered snippet.
 */
export async function getAdminKeyCiphertext(
  projectId: string,
): Promise<string | null> {
  const rows = await db
    .select({ adminKeyEnc: projectSecrets.adminKeyEnc })
    .from(projectSecrets)
    .where(eq(projectSecrets.projectId, projectId));
  return rows[0]?.adminKeyEnc ?? null;
}
