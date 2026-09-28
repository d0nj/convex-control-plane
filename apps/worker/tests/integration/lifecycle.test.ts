import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDocker } from "../../src/docker.js";
import {
  createAdminDb,
  createHandlers,
  validateCreateInput,
} from "../../src/jobs.js";
import { db, projects } from "@control/db";
import { eq } from "drizzle-orm";

/**
 * FLAGGED INTEGRATION TEST — not run in CI.
 *
 * Exercises the real lifecycle against a live local Docker daemon and a
 * throwaway Postgres: create -> healthy -> delete (with `dropDb`), plus a
 * `project.delete` without `dropDb` that must retain the database.
 *
 * Preconditions (documented in the package.json `test:integration` script and
 * vitest.integration.config.ts):
 *   1. Docker daemon reachable on /var/run/docker.sock (or DOCKER_HOST).
 *   2. A throwaway control Postgres with `pnpm db:migrate` applied.
 *   3. A throwaway convex-data Postgres reachable via CONVEX_PG_ADMIN_URL.
 *   4. Env: DATABASE_URL, CONVEX_PG_ADMIN_URL, CONVEX_PG_URL_BASE, BASE_DOMAIN,
 *      CONVEX_BACKEND_IMAGE, SECRETS_KEY.
 *
 * When any required env var is absent the suite is skipped rather than failed,
 * so `test:integration` is safe to invoke anywhere.
 */
const REQUIRED = [
  "DATABASE_URL",
  "CONVEX_PG_ADMIN_URL",
  "CONVEX_PG_URL_BASE",
  "BASE_DOMAIN",
  "CONVEX_BACKEND_IMAGE",
  "SECRETS_KEY",
] as const;

const missing = REQUIRED.filter((name) => !process.env[name]);
const enabled = missing.length === 0;

describe.skipIf(!enabled)("worker lifecycle (integration)", () => {
  const slug = `it-${randomUUID().slice(0, 8)}`;

  it("creates a project to healthy then deletes it with dropDb", async () => {
    const docker = createDocker();
    const admin = createAdminDb(process.env.CONVEX_PG_ADMIN_URL!);
    const handlers = createHandlers({
      db,
      docker,
      admin,
      config: {
        domain: process.env.BASE_DOMAIN!,
        backendImage: process.env.CONVEX_BACKEND_IMAGE!,
        convexPgUrlBase: process.env.CONVEX_PG_URL_BASE!,
        healthTimeoutMs: 120_000,
        healthPollIntervalMs: 2_000,
      },
    });

    const input = validateCreateInput({
      projectId: randomUUID(),
      teamId: "integration-team",
      slug,
    });
    await handlers.create([{ data: input } as never]);

    const created = (await db.select().from(projects).where(eq(projects.slug, slug)))[0];
    expect(created?.status).toBe("healthy");

    await handlers.remove([{ data: { slug, dropDb: true } } as never]);
    const after = await db.select().from(projects).where(eq(projects.slug, slug));
    expect(after).toHaveLength(0);

    docker.close();
  });
});
