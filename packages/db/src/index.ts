import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./slug.js";

/**
 * Drizzle client for the control database.
 *
 * The pool is lazy: no connection is opened until the first query, so
 * importing this module never requires a reachable Postgres.
 *
 * Auth tables live in the CLI-generated `./auth-schema.js` (see `schema.ts`);
 * re-export and pass them to the adapter from Task 3 once generated.
 */
export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), {
  schema,
});
