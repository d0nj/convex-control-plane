import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-server";
import { listTeamsForUser } from "@/lib/teams";

/**
 * `/` — route the signed-in user to their first team, or explain that they have
 * none yet. Anonymous visitors are sent to sign-in by middleware, but the
 * authoritative check is repeated here.
 */
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const teams = await listTeamsForUser(session.user.id);
  const first = teams[0];
  if (first) redirect(`/teams/${first.slug}/projects`);

  return (
    <>
      <h1>Convex Control Plane</h1>
      <div className="panel">
        <p>You are signed in as {session.user.email}, but you are not a member of any team yet.</p>
        <p className="muted">
          Ask a team owner to invite you, or create a team from the organization
          API. Once you belong to a team its projects appear in the header.
        </p>
        <p>
          <Link href="/admin">Open the platform admin page</Link>
        </p>
      </div>
    </>
  );
}
