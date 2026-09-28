import { auth } from "@control/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * better-auth catch-all handler.
 *
 * Every better-auth endpoint (sign-in/up, OAuth callbacks, organization, admin,
 * SSO) is served under `/api/auth/*`. The handler is exported as-is; there is no
 * custom logic here by design — authorization lives in the pages and actions.
 */
export const { GET, POST } = toNextJsHandler(auth);
