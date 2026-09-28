import { createAdminDb, createHandlers, HEALTH_POLL_CRON, jobKey, projectSlugFromDockerEvent, QUEUE_NAMES, QUEUE_OPTIONS } from "./jobs.js";
import type { HealthPollInput } from "./jobs.js";
import { createDocker } from "./docker.js";
import type { DockerApi } from "./docker.js";
import { db } from "@control/db";
import { pathToFileURL } from "node:url";
import { PgBoss } from "pg-boss";

/**
 * Worker entrypoint.
 *
 * Responsibilities (design §3, brief Task 5):
 * 1. Create the pg-boss instance on the control `DATABASE_URL` (pg-boss stores
 *    its queues in the same Postgres — no Redis).
 * 2. Register the seven queues, each with backoff retries and a
 *    `project:<slug>:<op>` job key so duplicate enqueues collapse.
 * 3. Start a Docker events listener that re-checks project health when a
 *    managed backend container dies/stops/restarts.
 * 4. Drain cleanly on SIGTERM: stop accepting work, finish in-flight jobs,
 *    close the Docker event stream.
 *
 * This process is the ONLY one with a read-write Docker socket. It never
 * displays secret values: secrets are decrypted only to hand them to Docker's
 * env, and encrypted before they touch the database.
 */

/** Fail fast when a required env var is absent — never start half-configured. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Wire pg-boss queues to their handlers. */
async function registerQueues(
  boss: PgBoss,
  handlers: ReturnType<typeof createHandlers>,
): Promise<void> {
  for (const name of QUEUE_NAMES) {
    await boss.createQueue(name, QUEUE_OPTIONS);
  }
  await boss.work("project.create", handlers.create);
  await boss.work("project.delete", handlers.remove);
  await boss.work("project.update", handlers.update);
  await boss.work("project.restart", handlers.restart);
  await boss.work("project.key-rotate", handlers.keyRotate);
  await boss.work("project.dashboard-toggle", handlers.dashboardToggle);
  await boss.work("health.poll", handlers.healthPoll);
}

/**
 * Follow Docker container events and enqueue a targeted `health.poll` whenever a
 * managed backend changes state. Errors are logged, never fatal: the cron sweep
 * is the correctness floor.
 */
async function startDockerEventsListener(
  boss: PgBoss,
  docker: DockerApi,
): Promise<() => Promise<void>> {
  return docker.watchEvents(async (dockerEvent) => {
    const slug = projectSlugFromDockerEvent(dockerEvent);
    if (!slug) return;
    const payload: HealthPollInput = { slug };
    await boss.send("health.poll", payload, {
      singletonKey: jobKey(slug, "poll"),
    });
  });
}

/** Boot the worker. Exported so the integration test can drive it directly. */
export async function main(): Promise<void> {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const convexPgAdminUrl = requiredEnv("CONVEX_PG_ADMIN_URL");
  const config = {
    domain: requiredEnv("BASE_DOMAIN"),
    backendImage: requiredEnv("CONVEX_BACKEND_IMAGE"),
    convexPgUrlBase: requiredEnv("CONVEX_PG_URL_BASE"),
  };

  const boss = new PgBoss(databaseUrl);
  boss.on("error", (err: Error) => console.error("pg-boss error:", err.message));
  await boss.start();

  const docker = createDocker();
  const admin = createAdminDb(convexPgAdminUrl);
  const handlers = createHandlers({ db, docker, admin, config });
  await registerQueues(boss, handlers);

  // Health sweep every 60s (design §3), in addition to the events listener.
  // No singletonKey here: each minute's sweep must run even if the previous one
  // is still finishing (the sweep itself is idempotent).
  await boss.schedule("health.poll", HEALTH_POLL_CRON, {});
  const stopEvents = await startDockerEventsListener(boss, docker);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`received ${signal}; draining`);
    await stopEvents().catch(() => {});
    // graceful: finish in-flight jobs, then close.
    await boss.stop({ graceful: true, timeout: 30_000 });
    docker.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("worker ready: 7 queues registered, docker events listener active");
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error("worker failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
