import { db } from "@control/db";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";

/**
 * better-auth server instance for the control plane.
 *
 * Model (design §2, v1):
 * - `organization` plugin is used as the **team** concept, flat: the
 *   teams-subfeature is OFF (`teams: { enabled: false }`) so there is no
 *   nested team layer — an organization *is* a team.
 * - Roles are the organization defaults `owner` > `admin` > `member`
 *   (see `./roles.ts` for the `requireRole` guard web handlers call).
 * - `admin` plugin marks a **platform** admin; the first user to sign up is
 *   promoted to it (there is no per-project ACL in v1 — team membership
 *   grants access to every project of that team).
 * - `@better-auth/sso` adds per-team OIDC/SAML sign-in, registered from team
 *   settings (Task 6) with no options here.
 *
 * Logins: email+password, Google and GitHub OAuth. OAuth providers are only
 * registered when both their client id and secret are present, so leaving the
 * env unset simply disables that provider (see `.env.example`).
 *
 * This module is also the CLI config: the better-auth CLI loads it and reads
 * `auth.options` to generate `packages/db/src/auth-schema.ts`.
 */

/** Register an OAuth provider only when both halves of its credential exist. */
function oauthProvider(
  clientId: string | undefined,
  clientSecret: string | undefined,
): { clientId: string; clientSecret: string } | undefined {
  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

const google = oauthProvider(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);
const github = oauthProvider(
  process.env.GITHUB_CLIENT_ID,
  process.env.GITHUB_CLIENT_SECRET,
);

// Fail fast when a production runtime is missing BETTER_AUTH_SECRET: better-auth
// otherwise falls back to a public default secret, making every session
// forgeable. Skipped during `next build`, which sets NODE_ENV=production but
// evaluates this module without runtime secrets — the guard must fire at
// `next start`/deploy, not break the build. Also skipped in dev/test (NODE_ENV
// unset or "test"), and by the better-auth CLI schema generator (not production).
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !process.env.BETTER_AUTH_SECRET
) {
  throw new Error(
    "BETTER_AUTH_SECRET is required in production (refusing better-auth's default secret)",
  );
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    ...(google ? { google } : {}),
    ...(github ? { github } : {}),
  },
  databaseHooks: {
    user: {
      create: {
        // First user becomes the platform admin; everyone else gets the
        // admin plugin default ("user"). The admin plugin's own hook runs
        // first, so this override wins.
        //
        // Fail closed: this hook needs the auth context to count existing
        // users. If it is ever invoked without one (test harness, a future
        // better-auth version), throwing is the only safe outcome — the
        // alternative is promoting *every* user to platform admin. Promotion
        // happens only on an explicit `=== 0`, never on a missing/undefined
        // count.
        before: async (user, ctx) => {
          if (!ctx) {
            throw new Error(
              "user.create.before requires an auth context to decide the first-user promotion",
            );
          }
          const existing = await ctx.context.internalAdapter.countTotalUsers();
          if (existing === 0) {
            return { data: { ...user, role: "admin" } };
          }
          return { data: user };
        },
      },
    },
  },
  plugins: [
    organization({
      // organization == team; no nested teams in v1.
      teams: { enabled: false },
    }),
    admin(),
    sso(),
  ],
});

export type Auth = typeof auth;
