"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Sign-in form (client component).
 *
 * Three paths, all handled by the better-auth client (design §2):
 *  - email + password,
 *  - Google / GitHub OAuth (only shown when the server registered the provider),
 *  - SSO: type an email domain and get redirected to the team's IdP.
 *
 * `next` is where to return after a successful sign-in (set by middleware).
 */
export function SignInForm({
  next = "/",
  providers,
}: {
  next?: string;
  providers: { google: boolean; github: boolean };
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPasswordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: err } = await authClient.signIn.email({
      email,
      password,
      callbackURL: next,
    });
    setPending(false);
    if (err) {
      setError(err.message ?? "Sign-in failed");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function onOAuth(provider: "google" | "github") {
    setError(null);
    await authClient.signIn.social({ provider, callbackURL: next });
  }

  async function onSso(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: err } = await authClient.signIn.sso({
      domain,
      callbackURL: next,
    });
    setPending(false);
    if (err) {
      setError(err.message ?? "SSO sign-in failed");
    }
  }

  return (
    <div className="panel">
      <form onSubmit={onPasswordSignIn}>
        <p>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </p>
        <p>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </p>
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {(providers.google || providers.github) && (
        <>
          <h2>Or continue with</h2>
          <div className="row">
            {providers.google && (
              <button
                className="secondary"
                type="button"
                onClick={() => onOAuth("google")}
              >
                Google
              </button>
            )}
            {providers.github && (
              <button
                className="secondary"
                type="button"
                onClick={() => onOAuth("github")}
              >
                GitHub
              </button>
            )}
          </div>
        </>
      )}

      <h2>Or sign in with your team SSO</h2>
      <form className="inline" onSubmit={onSso}>
        <div>
          <label htmlFor="domain">Email domain</label>
          <input
            id="domain"
            type="text"
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={pending}>
          Continue with SSO
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
