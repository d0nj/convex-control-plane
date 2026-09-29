import Link from "next/link";

import { getSession } from "@/lib/auth-server";
import { listTeamsForUser } from "@/lib/teams";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "./SignOutButton";

/**
 * Top navigation (server component).
 *
 * Reads the session and the user's teams so the header can offer a direct link
 * into each team's projects. Renders nothing team-specific when signed out.
 */
export async function SiteHeader() {
  const session = await getSession();
  const teams = session ? await listTeamsForUser(session.user.id) : [];

  return (
    <header className="sticky top-0 z-40 border-b bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground no-underline hover:no-underline"
        >
          Convex Control Plane
        </Link>
        <nav
          className="flex flex-wrap items-center gap-x-4 gap-y-1"
          aria-label="Primary"
        >
          {teams.map((team) => (
            <Link
              key={team.id}
              href={`/teams/${team.slug}/projects`}
              className="text-sm text-muted-foreground no-underline transition-colors hover:text-foreground hover:no-underline"
            >
              {team.name}
            </Link>
          ))}
          {session && (
            <Link
              href="/admin"
              className="text-sm text-muted-foreground no-underline transition-colors hover:text-foreground hover:no-underline"
            >
              Admin
            </Link>
          )}
        </nav>
        <span className="ml-auto" />
        {session ? (
          <span className="flex items-center gap-3">
            <span className="max-w-56 truncate text-sm text-muted-foreground">
              {session.user.email}
            </span>
            <SignOutButton />
          </span>
        ) : (
          <Button variant="outline" size="sm" render={<Link href="/sign-in" />}>
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}
