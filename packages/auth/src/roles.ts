/**
 * Team role model (flat, no per-project ACL in v1).
 *
 * Roles are a strict hierarchy — `owner` > `admin` > `member` — matching the
 * better-auth organization plugin defaults. Web handlers (Task 6) call
 * {@link requireRole} before mutating; the worker never makes this decision.
 *
 * Platform admins (the `admin` plugin's `role: "admin"` on the user record,
 * promoted for the first user at sign-up) are a separate axis from team roles:
 * they may act across every team, so `requireRole` accepts a `platformAdmin`
 * bypass flag that callers set from the session user.
 */

/** Team roles from least to most privileged. */
export const TEAM_ROLES = ["member", "admin", "owner"] as const;

/** A role held by a user inside one team (organization). */
export type TeamRole = (typeof TEAM_ROLES)[number];

const RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 };

/** True when `value` is one of the three team roles. */
export function isTeamRole(value: unknown): value is TeamRole {
  return (
    typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value)
  );
}

/** True when `actual` is a team role at least as privileged as `required`. */
export function hasRole(
  actual: string | null | undefined,
  required: TeamRole,
): boolean {
  if (!isTeamRole(actual)) return false;
  return RANK[actual] >= RANK[required];
}

/** Thrown by {@link requireRole}; web handlers map this to a 403 response. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Assert `actual` meets `required`, unless the caller is a platform admin.
 *
 * @throws {ForbiddenError} when the role is missing or too low.
 */
export function requireRole(
  actual: string | null | undefined,
  required: TeamRole,
  options: { platformAdmin?: boolean } = {},
): void {
  if (options.platformAdmin) return;
  if (!hasRole(actual, required)) {
    throw new ForbiddenError(
      `requires team role "${required}" (got ${actual ?? "none"})`,
    );
  }
}
