import Link from "next/link";

import { getSession } from "@/lib/auth-server";
import { listTeamsForUser } from "@/lib/teams";
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
    <header className="site-header">
      <Link href="/">
        <strong>Convex Control Plane</strong>
      </Link>
      <nav>
        {teams.map((team) => (
          <Link key={team.id} href={`/teams/${team.slug}/projects`}>
            {team.name}
          </Link>
        ))}
        {session && <Link href="/admin">Admin</Link>}
      </nav>
      <span className="spacer" />
      {session ? (
        <span className="row">
          <span className="muted">{session.user.email}</span>
          <SignOutButton />
        </span>
      ) : (
        <Link href="/sign-in">Sign in</Link>
      )}
    </header>
  );
}
