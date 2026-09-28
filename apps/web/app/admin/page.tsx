import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SubmitForm } from "../components/SubmitForm";
import { getSession } from "@/lib/auth-server";
import {
  countMembers,
  isPlatformAdmin,
  isTeamSuspended,
  listAllTeams,
} from "@/lib/teams";
import { setSuspension } from "./actions";

/**
 * `/admin` — platform-owner view (design §4).
 *
 * Lists every team and lets a platform admin suspend or lift a suspension.
 * Non-admins get notFound() so team names never leak to outsiders. Suspension
 * is stored as `metadata.suspended` on the organization row (see lib/teams) and
 * enforced by POST /api/projects before any new work is enqueued.
 */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  if (!isPlatformAdmin(session.user)) {
    notFound();
  }

  const teams = await listAllTeams();
  const rows = await Promise.all(
    teams.map(async (team) => ({
      team,
      members: await countMembers(team.id),
      suspended: isTeamSuspended(team),
    })),
  );

  return (
    <>
      <h1>Platform admin</h1>
      <p className="muted">
        Suspend a team to stop it from creating new projects. Existing projects
        keep running.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>Slug</th>
              <th>Members</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, members, suspended }) => (
              <tr key={team.id}>
                <td>
                  <Link href={`/teams/${team.slug}/projects`}>{team.name}</Link>
                </td>
                <td>
                  <code>{team.slug}</code>
                </td>
                <td>{members}</td>
                <td>{suspended ? "suspended" : "active"}</td>
                <td>
                  <SubmitForm
                    action={setSuspension}
                    label={suspended ? "Unsuspend" : "Suspend"}
                    variant={suspended ? "secondary" : "danger"}
                    successText="Updated."
                  >
                    <input type="hidden" name="teamId" value={team.id} />
                    <input
                      type="hidden"
                      name="suspend"
                      value={suspended ? "false" : "true"}
                    />
                  </SubmitForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
