import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: a cheap, cookie-only gate (design §2).
 *
 * It does not hit the database — `getSessionCookie` only checks that a session
 * cookie is present, which is enough to bounce anonymous traffic away from the
 * app routes before a server component runs. The authoritative check still
 * happens in each page via `auth.api.getSession`; this is a redirect
 * convenience, not the security boundary.
 */

/** Routes that require a signed-in user. */
const PROTECTED_PREFIXES = ["/teams", "/projects", "/admin"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (!hasSession && isProtected(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Preserve where the user was headed so the form can return them there.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/teams/:path*", "/projects/:path*", "/admin", "/sign-in"],
};
