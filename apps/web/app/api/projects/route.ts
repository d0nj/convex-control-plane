import { ForbiddenError, requireRole } from "@control/auth";
import { db, isValidSlug, projects } from "@control/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getSession } from "@/lib/auth-server";
import { enqueue } from "@/lib/boss";
import { jobKey } from "@/lib/jobs";
import {
  getTeamById,
  getTeamRole,
  isPlatformAdmin,
  isTeamSuspended,
} from "@/lib/teams";

/**
 * `POST /api/projects` — create a project.
 *
 * Contract (brief Task 6): validate the session, require team role admin or
 * owner, validate the slug, insert a `pending` row, enqueue `project.create`
 * with job key `project:<slug>:create`, and return `202` with the project id.
 *
 * The route NEVER provisions: it only writes the pending row and hands the job
 * to the worker (design §3). If the enqueue fails, the pending row is removed
 * so no orphaned, never-provisioned project is left behind.
 */

/** PostgreSQL unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

interface CreateBody {
  teamId?: unknown;
  slug?: unknown;
  displayName?: unknown;
}

/** Parse and narrow the JSON body without trusting any field. */
function readBody(value: unknown): CreateBody {
  if (typeof value !== "object" || value === null) return {};
  return value as CreateBody;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const body = readBody(raw);

  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim() !== ""
      ? body.displayName.trim()
      : slug;

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }
  if (!isValidSlug(slug)) {
    return NextResponse.json(
      {
        error:
          "invalid slug: use 2-62 chars, a leading lowercase letter, then lowercase letters/digits/dashes, and avoid reserved names",
      },
      { status: 400 },
    );
  }

  // Role check: admin or owner of the team (platform admins bypass, design §2).
  try {
    const role = await getTeamRole(session.user.id, teamId);
    requireRole(role, "admin", { platformAdmin: isPlatformAdmin(session.user) });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  // A suspended team keeps its data but cannot enqueue new work (design §4).
  const team = await getTeamById(teamId);
  if (team && isTeamSuspended(team)) {
    return NextResponse.json(
      { error: `team "${team.slug}" is suspended` },
      { status: 403 },
    );
  }

  const backendImage =
    process.env.CONVEX_BACKEND_IMAGE ??
    "ghcr.io/get-convex/convex-backend:latest";
  const projectId = randomUUID();

  try {
    await db.insert(projects).values({
      id: projectId,
      teamId,
      slug,
      displayName,
      backendImage,
      status: "pending",
    });
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: `slug "${slug}" is already taken` },
        { status: 409 },
      );
    }
    throw err;
  }

  try {
    await enqueue(
      "project.create",
      { projectId, teamId, slug, displayName, backendImage },
      jobKey(slug, "create"),
    );
  } catch (err) {
    // Compensate: never leave a pending row that no worker will ever pick up.
    await db.delete(projects).where(eq(projects.id, projectId)).catch(() => {});
    console.error(
      "failed to enqueue project.create:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "could not enqueue provisioning job" },
      { status: 503 },
    );
  }

  return NextResponse.json({ projectId }, { status: 202 });
}
