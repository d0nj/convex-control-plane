import { randomBytes, randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret } from "@control/auth";
import {
  buildApiUrl,
  buildSiteUrl,
  db as controlDb,
  deploymentEvents,
  isValidSlug,
  projects,
  projectSecrets,
  slugToDbName,
} from "@control/db";
import {
  buildBackendContainerSpec,
  dashboardSpec,
} from "@control/orchestrator";
import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { Client } from "pg";

import type { DockerApi, DockerEvent } from "./docker.js";

/**
 * The seven pg-boss queues the worker owns. Names are the contract with the web
 * app (Task 6), which only ever enqueues; it never provisions.
 */
export const QUEUE_NAMES = [
  "project.create",
  "project.delete",
  "project.update",
  "project.restart",
  "project.key-rotate",
  "project.dashboard-toggle",
  "health.poll",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** Operation suffix used in the idempotency key `project:<slug>:<op>`. */
export type JobOp = "create" | "delete" | "update" | "restart" | "key-rotate" | "dashboard-toggle" | "poll";

/**
 * Idempotency key for a job: `project:<slug>:<op>` (design §3). Web and worker
 * derive it the same way, and it is passed as pg-boss's `singletonKey` so a
 * double-click cannot enqueue the same provisioning step twice.
 */
export function jobKey(slug: string, op: JobOp): string {
  return `project:${slug}:${op}`;
}

/** Drizzle client type for the control database (shared with the web app). */
export type ControlDb = typeof controlDb;

/** Payload of `project.create` (also the shape the web app sends). */
export interface CreateInput {
  /** Caller-generated id; the web app inserts the pending row with this id. */
  projectId?: string;
  teamId: string;
  slug: string;
  displayName?: string;
  backendImage?: string;
}

/** Payloads of the remaining queues. */
export interface DeleteInput {
  slug: string;
  /** Explicit opt-in to `DROP DATABASE`; never implied by delete alone. */
  dropDb?: boolean;
}
export interface UpdateInput {
  slug: string;
  backendImage: string;
}
export interface SlugInput {
  slug: string;
}
export interface DashboardToggleInput {
  slug: string;
  enabled: boolean;
}
export interface HealthPollInput {
  /** Optional: when absent the poll sweeps every managed project. */
  slug?: string;
}

/** Validated `project.create` payload: `slug` and `teamId` are guaranteed. */
export type ValidatedCreateInput = CreateInput & { teamId: string; slug: string };

/**
 * Validate a `project.create` payload. Delegates slug rules to
 * `isValidSlug` (Task 2) so the reserved-name / charset rules live in one
 * place, and requires a non-empty `teamId`. Pure and synchronous: the unit
 * tests exercise only this function.
 */
export function validateCreateInput(input: unknown): ValidatedCreateInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("project.create payload must be an object");
  }
  const candidate = input as Record<string, unknown>;
  const teamId = candidate.teamId;
  if (typeof teamId !== "string" || teamId.trim() === "") {
    throw new Error("project.create requires a teamId");
  }
  const slug = candidate.slug;
  if (typeof slug !== "string" || !isValidSlug(slug)) {
    throw new Error(`invalid project slug: ${JSON.stringify(slug)}`);
  }
  return { ...(input as CreateInput), teamId, slug };
}

/** Per-project database name, validated before it can reach a DDL statement. */
const DB_NAME_RE = /^[a-z][a-z0-9_]{1,61}$/;

/**
 * The privileged `convex-data` Postgres surface used only for database
 * lifecycle. `CREATE`/`DROP DATABASE` cannot run in a transaction and must
 * connect to a database other than the one being dropped, so this is a
 * short-lived admin connection, separate from the control-db drizzle client.
 */
export interface AdminDb {
  createDatabase(name: string): Promise<void>;
  dropDatabase(name: string): Promise<void>;
}

/** `true` when a pg error carries `code` (e.g. `42P04` duplicate_database). */
function hasPgCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code;
}

/**
 * Build an {@link AdminDb} over `CONVEX_PG_ADMIN_URL`. Each statement opens a
 * throwaway connection so a failed DDL never poisons a pooled session.
 * Idempotent: `CREATE` tolerates an existing database, `DROP` uses
 * `IF EXISTS ... WITH (FORCE)` (Postgres 13+).
 */
export function createAdminDb(connectionString: string): AdminDb {
  async function run(sql: string): Promise<void> {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }

  function assertName(name: string): void {
    if (!DB_NAME_RE.test(name)) {
      throw new Error(`refusing unsafe database name: ${JSON.stringify(name)}`);
    }
  }

  return {
    async createDatabase(name) {
      assertName(name);
      try {
        await run(`CREATE DATABASE "${name}"`);
      } catch (err) {
        if (!hasPgCode(err, "42P04")) throw err; // 42P04 = duplicate_database
      }
    },
    async dropDatabase(name) {
      assertName(name);
      try {
        await run(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } catch (err) {
        if (!hasPgCode(err, "3D000")) throw err; // 3D000 = invalid_catalog_name
      }
    },
  };
}

/** Worker runtime configuration, read from the compose-provided env. */
export interface WorkerConfig {
  /** `BASE_DOMAIN` — public DNS suffix for the two project hosts. */
  domain: string;
  /** `CONVEX_BACKEND_IMAGE` — default image for new projects. */
  backendImage: string;
  /** `CONVEX_PG_URL_BASE` — postgres URL WITHOUT a database name. */
  convexPgUrlBase: string;
  /** How long to poll `/version` before marking a project failed. */
  healthTimeoutMs?: number;
  /** Interval between `/version` polls while provisioning. */
  healthPollIntervalMs?: number;
  /** Consecutive unhealthy `health.poll` results before `degraded`. */
  unhealthyThreshold?: number;
}

/** Everything a handler needs; injected so tests can supply fakes. */
export interface HandlerContext {
  db: ControlDb;
  docker: DockerApi;
  admin: AdminDb;
  config: WorkerConfig;
  /** Optional structured logger; never receives secret values. */
  logger?: (message: string) => void;
  /** Per-worker consecutive-unhealthy counters for `health.poll`. */
  unhealthyCounts?: Map<string, number>;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 120_000;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 2_000;
const DEFAULT_UNHEALTHY_THRESHOLD = 3;

/** A pg-boss handler over an array of jobs, as `boss.work` expects. */
export type Handler<T> = (jobs: Job<T>[]) => Promise<void>;

/** `true` when `slug` names a managed backend container. */
function backendContainerName(slug: string): string {
  return `convex-${slug}`;
}

/** Sleep, but resolve early (and harmlessly) if the process is shutting down. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run the first function for each job in a batch, sequentially. */
function forEachJob<T>(jobs: Job<T>[], fn: (data: T) => Promise<void>): Promise<void> {
  return jobs.reduce(
    (chain, job) => chain.then(() => fn(job.data)),
    Promise.resolve(),
  );
}

/**
 * Append one `deployment_events` row. Every provisioning step writes exactly
 * one of these, so the project's event feed is a faithful step log. The id is a
 * random UUID (never a secret).
 */
export async function event(
  db: ControlDb,
  entry: { projectId: string; job: string; message: string; level?: string },
): Promise<void> {
  await db.insert(deploymentEvents).values({
    id: randomUUID(),
    projectId: entry.projectId,
    job: entry.job,
    message: entry.message,
    level: entry.level ?? "info",
  });
}

/** Look up a project row by slug; throws when it does not exist. */
async function requireProject(db: ControlDb, slug: string) {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug));
  const row = rows[0];
  if (!row) throw new Error(`unknown project slug: ${slug}`);
  return row;
}

/** Set a project's lifecycle status. */
async function setStatus(
  db: ControlDb,
  projectId: string,
  status: (typeof projects.$inferInsert)["status"],
): Promise<void> {
  await db.update(projects).set({ status }).where(eq(projects.id, projectId));
}

/** Read and decrypt the persisted instance secret, or `null` when absent. */
async function readInstanceSecret(
  db: ControlDb,
  projectId: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(projectSecrets)
    .where(eq(projectSecrets.projectId, projectId));
  const existing = rows[0];
  return existing ? decryptSecret(existing.instanceSecretEnc) : null;
}

/**
 * Read the project's stored instance secret, generating and encrypting a fresh
 * random 32-byte hex secret the first time. Idempotent across retries: the
 * secret is only generated when no `project_secrets` row exists, so a retried
 * create reuses the same secret and the container stays consistent.
 */
async function loadOrCreateInstanceSecret(
  db: ControlDb,
  projectId: string,
): Promise<string> {
  const existing = await readInstanceSecret(db, projectId);
  if (existing) return existing;

  // Same entropy as upstream `openssl rand -hex 32` (design §2).
  const instanceSecret = randomBytes(32).toString("hex");
  await db
    .insert(projectSecrets)
    .values({
      projectId,
      instanceSecretEnc: encryptSecret(instanceSecret),
      adminKeyEnc: encryptSecret(""), // placeholder until keygen runs
    })
    .onConflictDoNothing();

  // Re-read rather than returning the local value. If a concurrent caller won
  // the insert, our value was discarded: returning it would hand Docker a
  // secret that does not match the one at rest, so the backend would start
  // with a mismatched INSTANCE_SECRET and the project would fail. Reading back
  // makes every caller converge on the single persisted secret.
  const persisted = await readInstanceSecret(db, projectId);
  if (!persisted) {
    throw new Error(`project_secrets row for ${projectId} missing after insert`);
  }
  return persisted;
}

/** Poll the container's `/version` until it answers, or the timeout elapses. */
async function waitForHealthy(
  docker: DockerApi,
  name: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await docker.version(name)) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Build the job handlers. Every handler is idempotent and safe to retry with
 * pg-boss backoff, writes one `deployment_events` row per step, and never logs
 * or returns a secret value.
 */
export function createHandlers(ctx: HandlerContext) {
  const { db, docker, admin, config } = ctx;
  const log = ctx.logger ?? (() => {});
  const unhealthy = ctx.unhealthyCounts ?? new Map<string, number>();
  const healthTimeoutMs = config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const healthPollIntervalMs =
    config.healthPollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS;
  const unhealthyThreshold =
    config.unhealthyThreshold ?? DEFAULT_UNHEALTHY_THRESHOLD;

  /** `project.create`: validate → reserve → DB → container → key → healthy. */
  const create: Handler<CreateInput> = (jobs) =>
    forEachJob(jobs, async (raw) => {
      const input = validateCreateInput(raw);
      const projectId = input.projectId ?? randomUUID();
      const displayName = input.displayName ?? input.slug;
      const backendImage = input.backendImage ?? config.backendImage;

      // 1. Reserve the row (idempotent) and move it to provisioning.
      await db
        .insert(projects)
        .values({ id: projectId, teamId: input.teamId, slug: input.slug, displayName, backendImage, status: "pending" })
        .onConflictDoNothing();
      const project = await requireProject(db, input.slug);
      await setStatus(db, project.id, "provisioning");
      await event(db, { projectId: project.id, job: "project.create", message: "reserved project; status provisioning" });

      // 2. Per-project database (name derived from slug; idempotent).
      const dbName = slugToDbName(input.slug);
      await admin.createDatabase(dbName);
      await event(db, { projectId: project.id, job: "project.create", message: `database ${dbName} ready` });

      // 3. Backend container (spec is pure; this is the only Docker call site).
      const instanceSecret = await loadOrCreateInstanceSecret(db, project.id);
      const spec = buildBackendContainerSpec({
        slug: input.slug,
        domain: config.domain,
        backendImage,
        postgresBaseUrl: config.convexPgUrlBase,
        instanceSecret,
      });
      await docker.ensureContainer(spec);
      await event(db, { projectId: project.id, job: "project.create", message: `container ${spec.name} started` });

      // 4. Poll /version; on timeout keep the container for inspection.
      const healthy = await waitForHealthy(
        docker,
        spec.name,
        healthTimeoutMs,
        healthPollIntervalMs,
      );
      if (!healthy) {
        await setStatus(db, project.id, "failed");
        await event(db, { projectId: project.id, job: "project.create", message: "backend /version did not become healthy", level: "error" });
        throw new Error(`project ${input.slug} did not become healthy`);
      }
      const convexVersion = (await docker.version(spec.name)) ?? null;

      // 5. Issue the admin key inside the container and encrypt it at rest.
      const adminKey = await docker.execAdminKey(spec.name);
      await db
        .update(projectSecrets)
        .set({ adminKeyEnc: encryptSecret(adminKey), rotatedAt: new Date() })
        .where(eq(projectSecrets.projectId, project.id));
      await event(db, { projectId: project.id, job: "project.create", message: "admin key issued and stored" });

      // 6. Mark healthy with public URLs.
      const apiUrl = buildApiUrl(input.slug, config.domain);
      const siteUrl = buildSiteUrl(input.slug, config.domain);
      await db
        .update(projects)
        .set({ status: "healthy", apiUrl, siteUrl, convexVersion })
        .where(eq(projects.id, project.id));
      await event(db, { projectId: project.id, job: "project.create", message: `healthy at ${apiUrl}` });
      log(`project.create ${input.slug}: healthy`);
    });

  /** `project.delete`: stop/rm containers, optional guarded DROP, delete rows. */
  const remove: Handler<DeleteInput> = (jobs) =>
    forEachJob(jobs, async ({ slug, dropDb }) => {
      const project = await requireProject(db, slug);
      await setStatus(db, project.id, "deleting");
      await event(db, { projectId: project.id, job: "project.delete", message: "status deleting" });

      await docker.stopContainer(backendContainerName(slug));
      await docker.removeContainer(backendContainerName(slug));
      await event(db, { projectId: project.id, job: "project.delete", message: "backend container removed" });

      if (project.dashboardEnabled) {
        const apiUrl = project.apiUrl ?? buildApiUrl(slug, config.domain);
        await docker.removeContainer(dashboardSpec(slug, config.domain, apiUrl).name);
        await event(db, { projectId: project.id, job: "project.delete", message: "dashboard container removed" });
      }

      // DROP DATABASE happens only on an explicit opt-in flag — a plain delete
      // must never destroy project data.
      if (dropDb) {
        const dbName = slugToDbName(slug);
        await admin.dropDatabase(dbName);
        await event(db, { projectId: project.id, job: "project.delete", message: `database ${dbName} dropped` });
      } else {
        await event(db, { projectId: project.id, job: "project.delete", message: "database retained (dropDb not set)" });
      }

      // Cascade removes project_secrets and this project's events.
      await db.delete(projects).where(eq(projects.id, project.id));
      log(`project.delete ${slug}: removed`);
    });

  /** `project.update`: pull image, recreate with same volume + DB. */
  const update: Handler<UpdateInput> = (jobs) =>
    forEachJob(jobs, async ({ slug, backendImage }) => {
      const project = await requireProject(db, slug);
      await event(db, { projectId: project.id, job: "project.update", message: `pulling ${backendImage}` });
      await docker.pullImage(backendImage);

      const instanceSecret = await loadOrCreateInstanceSecret(db, project.id);
      const spec = buildBackendContainerSpec({
        slug,
        domain: config.domain,
        backendImage,
        postgresBaseUrl: config.convexPgUrlBase,
        instanceSecret,
      });
      // Force a fresh container from the just-pulled image. The named volume
      // `<slug>-data` and the per-project database are untouched by the remove,
      // so data survives the image update (design §3).
      await docker.removeContainer(spec.name);
      await docker.ensureContainer(spec);
      const healthy = await waitForHealthy(docker, spec.name, healthTimeoutMs, healthPollIntervalMs);
      if (!healthy) {
        await setStatus(db, project.id, "failed");
        await event(db, { projectId: project.id, job: "project.update", message: "recreated backend unhealthy", level: "error" });
        throw new Error(`project ${slug} unhealthy after update`);
      }
      await db
        .update(projects)
        .set({ backendImage, status: "healthy" })
        .where(eq(projects.id, project.id));
      await event(db, { projectId: project.id, job: "project.update", message: `updated to ${backendImage}` });
    });

  /** `project.restart`: restart the backend container in place. */
  const restart: Handler<SlugInput> = (jobs) =>
    forEachJob(jobs, async ({ slug }) => {
      const project = await requireProject(db, slug);
      await docker.restartContainer(backendContainerName(slug));
      await event(db, { projectId: project.id, job: "project.restart", message: "backend container restarted" });
    });

  /** `project.key-rotate`: issue a new admin key, re-encrypt, invalidate old. */
  const keyRotate: Handler<SlugInput> = (jobs) =>
    forEachJob(jobs, async ({ slug }) => {
      const project = await requireProject(db, slug);
      const adminKey = await docker.execAdminKey(backendContainerName(slug));
      await db
        .update(projectSecrets)
        .set({ adminKeyEnc: encryptSecret(adminKey), rotatedAt: new Date() })
        .where(eq(projectSecrets.projectId, project.id));
      // The old key is superseded at rest; it stops working for new deploys.
      await event(db, { projectId: project.id, job: "project.key-rotate", message: "admin key rotated" });
    });

  /** `project.dashboard-toggle`: run or remove the dashboard container. */
  const dashboardToggle: Handler<DashboardToggleInput> = (jobs) =>
    forEachJob(jobs, async ({ slug, enabled }) => {
      const project = await requireProject(db, slug);
      const apiUrl = project.apiUrl ?? buildApiUrl(slug, config.domain);
      if (enabled) {
        await docker.ensureContainer(dashboardSpec(slug, config.domain, apiUrl));
        await event(db, { projectId: project.id, job: "project.dashboard-toggle", message: "dashboard enabled" });
      } else {
        await docker.removeContainer(dashboardSpec(slug, config.domain, apiUrl).name);
        await event(db, { projectId: project.id, job: "project.dashboard-toggle", message: "dashboard disabled" });
      }
      await db.update(projects).set({ dashboardEnabled: enabled }).where(eq(projects.id, project.id));
    });

  /**
   * `health.poll`: sweep managed projects, probe `/version`, and flip to
   * `degraded` after `unhealthyThreshold` consecutive failures (design §3).
   * Also invoked by the Docker events listener on container `die`/`stop`.
   */
  const healthPoll: Handler<HealthPollInput> = (jobs) =>
    forEachJob(jobs, async ({ slug }) => {
      const rows = slug
        ? await db.select().from(projects).where(eq(projects.slug, slug))
        : await db.select().from(projects);
      for (const project of rows) {
        if (project.status !== "healthy" && project.status !== "degraded") continue;
        const ok = Boolean(await docker.version(backendContainerName(project.slug)));
        if (ok) {
          unhealthy.delete(project.slug);
          if (project.status === "degraded") {
            await setStatus(db, project.id, "healthy");
            await event(db, { projectId: project.id, job: "health.poll", message: "recovered to healthy" });
          }
          continue;
        }
        const count = (unhealthy.get(project.slug) ?? 0) + 1;
        unhealthy.set(project.slug, count);
        if (count >= unhealthyThreshold && project.status !== "degraded") {
          await setStatus(db, project.id, "degraded");
          await event(db, { projectId: project.id, job: "health.poll", message: `unhealthy ${count} times in a row`, level: "warn" });
        }
      }
    });

  return { create, remove, update, restart, keyRotate, dashboardToggle, healthPoll };
}

/**
 * Translate a Docker container event into a health re-check for the affected
 * project. Container events carry the name without the leading slash.
 */
export function projectSlugFromDockerEvent(
  event: DockerEvent,
): string | undefined {
  const status = event.status ?? event.Action;
  if (status !== "die" && status !== "stop" && status !== "start" && status !== "restart") {
    return undefined;
  }
  const name = event.Actor?.Attributes?.name;
  if (!name || !name.startsWith("convex-")) return undefined;
  const slug = name.slice("convex-".length);
  return slug.startsWith("dash-") ? undefined : slug;
}

/** Queue registration options: backoff retries for every provisioning queue. */
export const QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 15 * 60,
} as const;

/** Cron expression for `health.poll`: every 60 seconds (design §3). */
export const HEALTH_POLL_CRON = "* * * * *";
