"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";

/**
 * better-auth browser client.
 *
 * Mirrors the server plugin set (organization = team, admin = platform admin,
 * sso = per-team OIDC/SAML) so the client's typed API matches the server
 * (design §2). Used by the sign-in form, the team switcher, and the mutation
 * forms that talk to better-auth endpoints directly.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient(), adminClient(), ssoClient()],
});

export type AuthClient = typeof authClient;
