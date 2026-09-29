import { ForbiddenError, requireRole } from "@control/auth";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth-server";
import { getProjectBySlug } from "@/lib/projects";
import { getTeamRole, isPlatformAdmin } from "@/lib/teams";

/**
 * `GET /api/projects/[slug]/logs` — proxy a container-log SSE stream.
 *
 * Auth mirrors the sibling `POST /api/projects` route's helpers: a session is
 * required (401), the project must exist (404), and the caller needs team role
 * member-or-higher with a platform-admin bypass (403). `?target=dashboard`
 * selects the dashboard container, otherwise the backend container streams.
 *
 * The worker owns the Docker socket; this route only forwards the validated
 * query to the worker logs endpoint and relays its `text/event-stream` body
 * back to the browser. Aborting the browser request tears down the upstream
 * fetch via `request.signal`. Log lines pass through as data and are never
 * logged here; the env value is only ever read, never written to a log.
 */

// Source of truth for container names is packages/orchestrator/src/container.ts
// (buildBackendContainerSpec → `convex-<slug>`, dashboardSpec →
// `convex-dash-<slug>`). This helper mirrors that naming locally so web never
// imports worker or orchestrator code.
function containerName(
  slug: string,
  target: string | null,
): { container: string; target: "backend" | "dashboard" } {
  if (target === "dashboard") {
    return { container: `convex-dash-${slug}`, target: "dashboard" };
  }
  return { container: `convex-${slug}`, target: "backend" };
}

const DEFAULT_TAIL = 200;
const MIN_TAIL = 1;
const MAX_TAIL = 2000;

/** Parse and bound `tail`; `null` when present-but-invalid. */
function parseTail(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_TAIL;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_TAIL || value > MAX_TAIL) {
    return null;
  }
  return value;
}

/** `follow=0` snapshots and closes; anything else (including absent) follows. */
function parseFollow(raw: string | null): boolean {
  return raw !== "0";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const project = await getProjectBySlug(slug);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const role = await getTeamRole(session.user.id, project.teamId);
    requireRole(role, "member", {
      platformAdmin: isPlatformAdmin(session.user),
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const { container } = containerName(slug, url.searchParams.get("target"));

  const tail = parseTail(url.searchParams.get("tail"));
  if (tail === null) {
    return NextResponse.json(
      { error: `invalid tail: use 1-${MAX_TAIL}` },
      { status: 400 },
    );
  }
  const follow = parseFollow(url.searchParams.get("follow"));

  const base = (process.env.WORKER_LOGS_URL ?? "http://worker:8080").replace(
    /\/+$/,
    "",
  );
  const upstream = `${base}/logs/${encodeURIComponent(container)}?tail=${tail}&follow=${follow ? "1" : "0"}`;

  let response: Response;
  try {
    response = await fetch(upstream, { signal: request.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    return NextResponse.json(
      { error: "could not reach the log stream" },
      { status: 502 },
    );
  }

  if (!response.ok || !response.body) {
    const status =
      response.status >= 400 && response.status < 600 ? response.status : 502;
    let message = "log stream failed";
    try {
      const data = (await response.json()) as { error?: unknown };
      if (typeof data.error === "string" && data.error) message = data.error;
    } catch {
      // Non-JSON upstream error: keep the generic message.
    }
    return NextResponse.json({ error: message }, { status });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
