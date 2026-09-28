import { describe, expect, it } from "vitest";

import {
  ForbiddenError,
  hasRole,
  isTeamRole,
  requireRole,
  TEAM_ROLES,
} from "../src/roles.js";

describe("team role model", () => {
  it("exposes the three roles least to most privileged", () => {
    expect(TEAM_ROLES).toEqual(["member", "admin", "owner"]);
  });

  it("accepts a real role and rejects an unknown string", () => {
    expect(isTeamRole("admin")).toBe(true);
  });

  it("rejects an invalid role string", () => {
    expect(isTeamRole("superuser")).toBe(false);
  });

  it("grants a higher rank when it meets the requirement (owner >= admin)", () => {
    expect(hasRole("owner", "admin")).toBe(true);
  });

  it("denies a lower rank when it misses the requirement (member < admin)", () => {
    expect(hasRole("member", "admin")).toBe(false);
  });

  it("denies a null/undefined role", () => {
    expect(hasRole(null, "member")).toBe(false);
  });

  it("does not throw when the role meets the requirement", () => {
    expect(() => requireRole("owner", "admin")).not.toThrow();
  });

  it("throws ForbiddenError when the role is too low", () => {
    expect(() => requireRole("member", "owner")).toThrow(ForbiddenError);
  });

  it("lets a platform admin bypass the team-role requirement", () => {
    expect(() =>
      requireRole(null, "owner", { platformAdmin: true }),
    ).not.toThrow();
  });
});
