import { describe, expect, it } from "vitest";

import { isValidSlug, slugToDbName } from "../src/slug.js";

describe("slugToDbName", () => {
  it("maps dashes to underscores", () => {
    expect(slugToDbName("my-project")).toBe("my_project");
  });
});

describe("isValidSlug", () => {
  it("rejects a reserved name", () => {
    expect(isValidSlug("api")).toBe(false);
  });

  it("rejects an uppercase slug", () => {
    expect(isValidSlug("Foo")).toBe(false);
  });

  it("accepts the two-character minimum", () => {
    expect(isValidSlug("a1")).toBe(true);
  });
});
