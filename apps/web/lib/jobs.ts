/**
 * pg-boss contract shared with the worker (apps/worker/src/jobs.ts).
 *
 * These values are duplicated on purpose: the worker owns the queues and
 * *consumes* them, while the web app only *produces* jobs. The queue names,
 * the `project:<slug>:<op>` job key, and the retry options are the wire
 * contract between the two processes, so they must stay identical. Keeping a
 * producer-side copy here lets the web app create a queue (idempotently) before
 * its first send, so a job can never be dropped just because the worker booted
 * a moment later.
 */

/** The seven provisioning queues (mirrors the worker's QUEUE_NAMES). */
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
export type JobOp =
  | "create"
  | "delete"
  | "update"
  | "restart"
  | "key-rotate"
  | "dashboard-toggle"
  | "poll";

/**
 * Idempotency key for a job: `project:<slug>:<op>` (design §3). Passed to
 * pg-boss as `singletonKey`, so a double-click collapses into one queued job.
 */
export function jobKey(slug: string, op: JobOp): string {
  return `project:${slug}:${op}`;
}

/**
 * Queue options applied when the web app lazily ensures a queue exists.
 * MUST match the worker's QUEUE_OPTIONS: pg-boss's `create_queue` is
 * `ON CONFLICT DO NOTHING`, so whichever process creates the queue first wins,
 * and identical options make the order irrelevant.
 */
export const QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 15 * 60,
} as const;
