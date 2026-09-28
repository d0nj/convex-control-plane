import { describe, expect, it } from "vitest";

import { validateCreateInput } from "../src/jobs.js";

/**
 * Input validation for the `project.create` job payload.
 *
 * These are the only unit tests for the worker: the Docker/Postgres lifecycle is
 * covered by the flagged integration suite (`pnpm --filter @control/worker
 * test:integration`), which needs a live Docker daemon and a throwaway Postgres.
 * Validation is pure, so it is tested here with one assertion per case.
 */
describe("validateCreateInput", () => {
  it("rejects a reserved slug", () => {
    expect(() => validateCreateInput({ slug: "api", teamId: "t1" })).toThrow();
  });

  it("rejects a missing teamId", () => {
    expect(() => validateCreateInput({ slug: "demo" })).toThrow();
  });

  it("accepts a valid slug with a teamId", () => {
    expect(() => validateCreateInput({ slug: "demo", teamId: "t1" })).not.toThrow();
  });
});
