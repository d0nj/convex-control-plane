import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Code-based migration runner for the control database.
 *
 * Replaces `drizzle-kit migrate` so the runtime image does not need the
 * drizzle-kit CLI: it only needs the `drizzle-orm` migrator plus `pg`, both of
 * which are already production dependencies of `@control/db`.
 *
 * CWD independence: the migrations folder is derived from this file's own URL
 * (`import.meta.url`), never from `process.cwd()`. The same script therefore
 * works when invoked from the repo root, from `packages/db`, or from a Docker
 * `WORKDIR` (e.g. `/repo` in the worker image) — `readMigrationFiles` resolves
 * the path we hand it with plain `fs` semantics, i.e. relative to CWD, so a
 * relative literal like `"./drizzle"` would break the moment the CWD differs.
 */

/** Absolute path to `packages/db/drizzle` (this file lives in `packages/db/src`). */
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Export it before running `pnpm --filter " +
      "@control/db db:migrate`; there is intentionally no localhost fallback.",
  );
}

// Bare client: the migrator only uses `db.dialect` and `db.session`, so no
// `schema` option (and no app schema import) is needed here.
const pool = new Pool({ connectionString });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  // Never log the connection string or any credential.
  console.log("Migrations applied successfully.");
} finally {
  await pool.end();
}
