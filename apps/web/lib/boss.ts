import { PgBoss } from "pg-boss";

import { QUEUE_OPTIONS, type QueueName } from "./jobs";

/**
 * Send-only pg-boss client for the web app.
 *
 * The web app never calls `work()` — provisioning is the worker's job. This
 * module exists so request handlers can enqueue a job and return immediately
 * (design §3, "Web (Task 6) only enqueues + reads DB, never touches Docker").
 *
 * A single PgBoss instance is started lazily and reused across requests; the
 * pool is only opened on the first send, so importing this module in a build
 * (or before Postgres is reachable) never fails.
 *
 * pg-boss refuses to send to a queue that does not exist, so before the first
 * send to a queue we create it with the shared QUEUE_OPTIONS (idempotent:
 * `create_queue` is `ON CONFLICT DO NOTHING`, and the options match the
 * worker's, so boot order between web and worker cannot change the result).
 */

let instance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;
const ensured = new Set<QueueName>();

/** The control-database connection string pg-boss stores its queues in. */
function connectionString(): string {
  const value = process.env.BOSS_DB ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "BOSS_DB (or DATABASE_URL) must be set for the web enqueue client",
    );
  }
  return value;
}

/** Start (once) and return the shared PgBoss instance. */
async function boss(): Promise<PgBoss> {
  if (instance) return instance;
  if (!starting) {
    const created = new PgBoss(connectionString());
    created.on("error", (err: Error) =>
      console.error("pg-boss error:", err.message),
    );
    starting = created.start();
  }
  instance = await starting;
  return instance;
}

/** Enqueue `data` on `name`, deduped by `singletonKey`. Returns the job id. */
export async function enqueue(
  name: QueueName,
  data: object,
  singletonKey: string,
): Promise<string | null> {
  const pg = await boss();
  if (!ensured.has(name)) {
    await pg.createQueue(name, QUEUE_OPTIONS);
    ensured.add(name);
  }
  return pg.send(name, data, { singletonKey });
}
