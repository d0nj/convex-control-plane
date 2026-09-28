import { decryptSecret } from "@control/auth";
import { buildApiUrl, buildSiteUrl } from "@control/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CopyButton } from "../../components/CopyButton";
import { SubmitForm } from "../../components/SubmitForm";
import { getSession } from "@/lib/auth-server";
import { getAdminKeyCiphertext, getProjectBySlug, listEvents } from "@/lib/projects";
import { getTeamById, getTeamRole, isPlatformAdmin } from "@/lib/teams";
import {
  deleteProject,
  restartProject,
  rotateProjectKey,
  toggleProjectDashboard,
  updateProjectImage,
} from "../actions";

/**
 * `/projects/[slug]` — a single project (design §4).
 *
 * Shows status, copyable public URLs, a `.env.local` snippet (the admin key is
 * decrypted here, server-side, and only ever appears inside the rendered
 * snippet — never sent to the client in any other form), the deployment event
 * feed, and the lifecycle actions.
 */

/** Decrypt the stored admin key for the snippet, or `null` when not issued yet. */
function adminKeySnippetValue(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    const value = decryptSecret(ciphertext);
    return value === "" ? null : value;
  } catch {
    // A key we cannot decrypt must never be displayed; surface it as absent.
    return null;
  }
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const project = await getProjectBySlug(slug);
  if (!project) notFound();

  const team = await getTeamById(project.teamId);
  const role = await getTeamRole(session.user.id, project.teamId);
  const platformAdmin = isPlatformAdmin(session.user);
  if (!platformAdmin && !role) notFound();

  const canMutate = platformAdmin || role === "admin" || role === "owner";
  const canDelete = platformAdmin || role === "owner";

  const domain = process.env.BASE_DOMAIN ?? "";
  const apiUrl = project.apiUrl ?? (domain ? buildApiUrl(slug, domain) : null);
  const siteUrl = project.siteUrl ?? (domain ? buildSiteUrl(slug, domain) : null);

  const events = await listEvents(project.id);
  const adminKey = adminKeySnippetValue(
    await getAdminKeyCiphertext(project.id),
  );
  const snippet =
    apiUrl && adminKey
      ? `CONVEX_SELF_HOSTED_URL='${apiUrl}'\nCONVEX_SELF_HOSTED_ADMIN_KEY='${adminKey}'`
      : null;

  return (
    <>
      <div className="row">
        <h1>{project.displayName}</h1>
        <span className="status">
          <span className={`dot ${project.status}`} />
          {project.status}
        </span>
        <span className="spacer" />
        {team && (
          <Link href={`/teams/${team.slug}/projects`}>← {team.name}</Link>
        )}
      </div>

      <div className="panel">
        <dl>
          <dt className="muted">Slug</dt>
          <dd>
            <code>{project.slug}</code>
          </dd>
          <dt className="muted">Backend image</dt>
          <dd>
            <code>{project.backendImage}</code>
          </dd>
          <dt className="muted">Convex version</dt>
          <dd>{project.convexVersion ?? <span className="muted">unknown</span>}</dd>
          <dt className="muted">Dashboard</dt>
          <dd>{project.dashboardEnabled ? "enabled" : "disabled"}</dd>
        </dl>

        <div className="row">
          <span>
            API:{" "}
            {apiUrl ? <code>{apiUrl}</code> : <span className="muted">pending</span>}
          </span>
          {apiUrl && <CopyButton text={apiUrl} label="Copy API URL" />}
        </div>
        <div className="row">
          <span>
            Site:{" "}
            {siteUrl ? <code>{siteUrl}</code> : <span className="muted">pending</span>}
          </span>
          {siteUrl && <CopyButton text={siteUrl} label="Copy site URL" />}
        </div>
      </div>

      <div className="panel">
        <h2>.env.local</h2>
        {snippet ? (
          <>
            <p className="muted">
              Point the Convex CLI at this deployment, then run{" "}
              <code>npx convex dev</code>. Treat these values as secrets.
            </p>
            <pre className="snippet">{snippet}</pre>
            <CopyButton text={snippet} label="Copy snippet" />
          </>
        ) : (
          <p className="muted">
            The admin key has not been issued yet. It appears here once the
            worker finishes provisioning.
          </p>
        )}
      </div>

      {canMutate && (
        <div className="panel">
          <h2>Actions</h2>
          <div className="row">
            <SubmitForm
              action={restartProject}
              label="Restart"
              variant="secondary"
              successText="Restart queued."
            >
              <input type="hidden" name="slug" value={project.slug} />
            </SubmitForm>

            <SubmitForm
              action={rotateProjectKey}
              label="Rotate key"
              variant="secondary"
              successText="Key rotation queued."
            >
              <input type="hidden" name="slug" value={project.slug} />
            </SubmitForm>

            <SubmitForm
              action={toggleProjectDashboard}
              label={project.dashboardEnabled ? "Disable dashboard" : "Enable dashboard"}
              variant="secondary"
              successText="Dashboard toggle queued."
            >
              <input type="hidden" name="slug" value={project.slug} />
              <input
                type="hidden"
                name="enabled"
                value={project.dashboardEnabled ? "false" : "true"}
              />
            </SubmitForm>
          </div>

          <h2>Update image</h2>
          <SubmitForm
            action={updateProjectImage}
            label="Update image"
            variant="secondary"
            successText="Image update queued."
          >
            <input type="hidden" name="slug" value={project.slug} />
            <div>
              <label htmlFor="backendImage">Backend image (pin a REV)</label>
              <input
                id="backendImage"
                name="backendImage"
                defaultValue={project.backendImage}
                required
              />
            </div>
          </SubmitForm>
        </div>
      )}

      {canDelete && (
        <div className="panel">
          <h2>Danger zone</h2>
          <p className="muted">
            Deleting stops and removes the containers. The project database is
            kept unless you also opt in to dropping it below.
          </p>
          <SubmitForm
            action={deleteProject}
            label="Delete project"
            variant="danger"
            successText="Deletion queued."
          >
            <input type="hidden" name="slug" value={project.slug} />
            <div>
              <label htmlFor="confirm">
                Type <code>{project.slug}</code> to confirm
              </label>
              <input id="confirm" name="confirm" autoComplete="off" required />
            </div>
            <p>
              <label>
                <input
                  type="checkbox"
                  name="dropDb"
                  style={{ width: "auto", marginRight: 8 }}
                />
                Also drop the project database (irreversible)
              </label>
            </p>
          </SubmitForm>
        </div>
      )}

      <div className="panel">
        <h2>Events</h2>
        {events.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <ul className="events">
            {events.map((event) => (
              <li key={event.id} className={event.level}>
                <code>{event.at.toISOString()}</code>{" "}
                <strong>{event.job}</strong> {event.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
