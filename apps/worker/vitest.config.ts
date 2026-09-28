import { defineConfig } from "vitest/config";

/**
 * Unit-test config. The default `pnpm test` run covers ONLY the pure,
 * dependency-free unit tests. The Docker/Postgres lifecycle lives under
 * `tests/integration/` and is excluded here — it runs via
 * `pnpm --filter @control/worker test:integration`, which is intentionally not
 * part of CI (no Docker daemon or throwaway Postgres is guaranteed there).
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/integration/**"],
  },
});
