import Link from "next/link";

import { SignUpForm } from "../components/SignUpForm";

/**
 * `/sign-up` — email+password account creation (design §2).
 *
 * Middleware bounces already-authenticated visitors away, so this page only
 * ever renders for anonymous traffic. The first account created on an
 * instance is automatically promoted to platform admin; that is stated
 * plainly below because it is a privilege the user should know about.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/";
  const signInHref =
    next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <>
      <h1>Create an account</h1>
      <p className="muted">
        The first account created on this instance is automatically promoted to
        platform admin.
      </p>
      <SignUpForm next={next} />
      <p className="muted">
        Already have an account? <Link href={signInHref}>Sign in</Link>
      </p>
    </>
  );
}
