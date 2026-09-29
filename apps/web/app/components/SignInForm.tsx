"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

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
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Email and password, an OAuth provider, or team SSO.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={onPasswordSignIn} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEmail(e.target.value)
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setPassword(e.target.value)
              }
              required
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {(providers.google || providers.github) && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">Or continue with</p>
              <div className="flex flex-wrap gap-2">
                {providers.google && (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => onOAuth("google")}
                  >
                    Google
                  </Button>
                )}
                {providers.github && (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => onOAuth("github")}
                  >
                    GitHub
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        <Separator />

        <form onSubmit={onSso} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Team SSO domain</Label>
            <Input
              id="domain"
              type="text"
              autoComplete="organization"
              placeholder="example.com"
              value={domain}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDomain(e.target.value)
              }
              required
            />
          </div>
          <Button variant="secondary" type="submit" disabled={pending}>
            Continue with SSO
          </Button>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
