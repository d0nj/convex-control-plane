import Link from "next/link";

import { SignInForm } from "../components/SignInForm";

/**
 * `/sign-in` — password, OAuth, and per-team SSO (design §4).
 *
 * Middleware bounces already-authenticated visitors away, so this page only
 * ever renders for anonymous traffic. The OAuth buttons are hidden unless the
 * server has the matching client credentials configured (Task 3 registers a
 * provider only when both halves of its credential are present).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/";
  const signUpHref =
    next === "/" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="space-y-1">
        <h1 className="m-0 text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with email and password, an OAuth provider, or your
          team&rsquo;s SSO domain.
        </p>
      </div>
      <SignInForm
        next={next}
        providers={{
          google: Boolean(
            process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
          ),
          github: Boolean(
            process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
          ),
        }}
      />
      <p className="text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href={signUpHref}>Create an account</Link>
      </p>
    </div>
  );
}
