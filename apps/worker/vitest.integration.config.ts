import { defineConfig } from "vitest/config";

/**
 * Integration config: create -> healthy -> delete against a live local Docker
 * daemon and a throwaway Postgres. NOT required in CI (the environment is not
 * guaranteed). Run it explicitly:
 *
 *   pnpm --filter @control/worker test:integration
 *
 * Required env (all supplied by the caller; never read from a committed file):
 *   DATABASE_URL, CONVEX_PG_ADMIN_URL, CONVEX_PG_URL_BASE, BASE_DOMAIN,
 *   CONVEX_BACKEND_IMAGE, SECRETS_KEY
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // The lifecycle mutates shared Docker/Postgres state: run serially.
    fileParallelism: false,
  },
});
