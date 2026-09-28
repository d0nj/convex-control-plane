import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as authSchema from "./auth-schema.js";
import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./slug.js";
export * as authSchema from "./auth-schema.js";

/**
 * Table names owned by better-auth's generated schema. App tables must never
 * reuse these names: a collision would let one silently shadow the other in
 * the merged schema object below (and confuse the better-auth adapter, which
 * resolves tables by model name). Asserted at module load so the failure is
 * loud and immediate rather than a missing-table error at runtime.
 */
const AUTH_TABLE_NAMES = Object.keys(authSchema).filter(
  (key) => !key.endsWith("Relations"),
);

/** Throw if an app table and an auth table share a key. */
function assertDisjointSchemas(
  app: Record<string, unknown>,
  auth: Record<string, unknown>,
): void {
  const collisions = Object.keys(app).filter((key) => key in auth);
  if (collisions.length > 0) {
    throw new Error(
      `@control/db schema collision: app table(s) ${collisions.join(", ")} ` +
        `shadow better-auth table(s) of the same name. Rename the app table ` +
        `(reserved: ${AUTH_TABLE_NAMES.join(", ")}).`,
    );
  }
}

assertDisjointSchemas(schema, authSchema);

/**
 * Drizzle client for the control database.
 *
 * The pool is lazy: no connection is opened until the first query, so
 * importing this module never requires a reachable Postgres.
 *
 * The better-auth drizzle adapter resolves tables by model name
 * (`schema[model]`, e.g. `schema.user`), so the generated auth tables from
 * `./auth-schema.js` are merged into the client's schema object alongside the
 * app tables. Without this the adapter cannot see `user`/`session`/etc. and
 * every auth query fails. `assertDisjointSchemas` guarantees the merge is
 * additive (no silent shadowing). `authSchema` is also re-exported so callers
 * can query the auth tables with full types (e.g. the first-user promotion).
 */
export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), {
  schema: { ...schema, ...authSchema },
});
