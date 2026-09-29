"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Sign-up form (client component).
 *
 * Creates the account through the better-auth client (`POST
 * /api/auth/sign-up/email`, design §2) and sends the user onward to `next`.
 * Server validation messages are shown inline. The first account created on an
 * instance is promoted to platform admin (see `packages/auth/src/auth.ts`);
 * the page states that next to this form.
 */
export function SignUpForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    const { error: err } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: next,
    });
    setPending(false);
    if (err) {
      setError(err.message ?? "Sign-up failed");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="panel">
      <form onSubmit={onSubmit}>
        <p>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </p>
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
          <label htmlFor="new-password">Password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </p>
        <p>
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            required
          />
        </p>
        <button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
