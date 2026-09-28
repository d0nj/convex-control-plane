import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as authSchema from "./auth-schema.js";
import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./slug.js";
export * as authSchema from "./auth-schema.js";

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
 * every auth query fails. `authSchema` is also re-exported so callers can
 * query the auth tables with full types (e.g. the first-user admin promotion).
 */
export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), {
  schema: { ...schema, ...authSchema },
});
