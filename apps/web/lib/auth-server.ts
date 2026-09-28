import { auth } from "@control/auth";
import { headers } from "next/headers";

/**
 * Server-side session helpers.
 *
 * Server components and server actions read the session through
 * `auth.api.getSession` (design §2) — never from a cookie parsed by hand. The
 * `headers()` call is the Next request scope, so this only works on the server.
 */

/** The current session, or `null` when signed out. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
