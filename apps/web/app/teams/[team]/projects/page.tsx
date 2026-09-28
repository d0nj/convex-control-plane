import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth-server";
import { listProjects } from "@/lib/projects";
import { getTeamBySlug, getTeamRole, isPlatformAdmin, isTeamSuspended } from "@/lib/teams";
import { CreateProjectForm } from "../../../components/CreateProjectForm";

/**
 * `/teams/[team]/projects` — a team's project list plus the create form.
 *
 * Membership is required to view; only admins/owners see the create form, and
 * the API enforces that role again server-side.
 */
export default async function TeamProjectsPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const team = await getTeamBySlug(teamSlug);
  if (!team) notFound();

  const role = await getTeamRole(session.user.id, team.id);
  const platformAdmin = isPlatformAdmin(session.user);
  if (!platformAdmin && !role) notFound();

  const projects = await listProjects(team.id);
  const canMutate = platformAdmin || role === "admin" || role === "owner";
  const suspended = isTeamSuspended(team);

  return (
    <>
      <div className="row">
        <h1>{team.name} — projects</h1>
        <span className="spacer" />
        <Link href={`/teams/${team.slug}/settings`}>Team settings</Link>
      </div>

      {suspended && (
        <p className="error-text">
          This team is suspended. New projects cannot be created until a
          platform admin lifts the suspension.
        </p>
      )}

      <div className="panel">
        {projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Project</th>
                <th>Slug</th>
                <th>API URL</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <span className="status">
                      <span className={`dot ${project.status}`} />
                      {project.status}
                    </span>
                  </td>
                  <td>
                    <Link href={`/projects/${project.slug}`}>
                      {project.displayName}
                    </Link>
                  </td>
                  <td>
                    <code>{project.slug}</code>
                  </td>
                  <td>{project.apiUrl ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canMutate && !suspended && (
        <div className="panel">
          <h2>Create project</h2>
          <CreateProjectForm teamId={team.id} />
        </div>
      )}
    </>
  );
}
