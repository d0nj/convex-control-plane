import { decryptSecret } from "@control/auth";
import { buildApiUrl, buildSiteUrl } from "@control/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CopyButton } from "../../components/CopyButton";
import { LogViewer } from "../../components/LogViewer";
import { ProjectStatusDot } from "../../components/StatusDot";
import { SubmitForm } from "../../components/SubmitForm";
import { getSession } from "@/lib/auth-server";
import { getAdminKeyCiphertext, getProjectBySlug, listEvents } from "@/lib/projects";
import { getTeamById, getTeamRole, isPlatformAdmin } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
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
 * snippet — never sent to the client in any other form), the live container
 * log viewer, the deployment event feed, and the lifecycle actions.
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-xl font-semibold tracking-tight">
          {project.displayName}
        </h1>
        <Badge variant="secondary" className="gap-1.5 capitalize">
          <ProjectStatusDot status={project.status} />
          {project.status}
        </Badge>
        <span className="ml-auto" />
        {team && (
          <Button variant="link" size="sm" className="px-0" render={<Link href={`/teams/${team.slug}/projects`} />}>
            ← {team.name}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="m-0">
              <code className="font-mono text-xs">{project.slug}</code>
            </dd>
            <dt className="text-muted-foreground">Backend image</dt>
            <dd className="m-0">
              <code className="font-mono text-xs">{project.backendImage}</code>
            </dd>
            <dt className="text-muted-foreground">Convex version</dt>
            <dd className="m-0">
              {project.convexVersion ?? (
                <span className="text-muted-foreground">unknown</span>
              )}
            </dd>
            <dt className="text-muted-foreground">Dashboard</dt>
            <dd className="m-0">
              {project.dashboardEnabled ? "enabled" : "disabled"}
            </dd>
          </dl>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">API:</span>
            {apiUrl ? (
              <code className="min-w-0 flex-1 break-all font-mono text-xs">
                {apiUrl}
              </code>
            ) : (
              <span className="text-muted-foreground">pending</span>
            )}
            {apiUrl && <CopyButton text={apiUrl} label="Copy API URL" />}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Site:</span>
            {siteUrl ? (
              <code className="min-w-0 flex-1 break-all font-mono text-xs">
                {siteUrl}
              </code>
            ) : (
              <span className="text-muted-foreground">pending</span>
            )}
            {siteUrl && <CopyButton text={siteUrl} label="Copy site URL" />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>.env.local</CardTitle>
          <CardDescription>
            Point the Convex CLI at this deployment, then run{" "}
            <code className="font-mono text-xs">npx convex dev</code>. Treat
            these values as secrets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {snippet ? (
            <div className="space-y-3">
              <pre className="overflow-x-auto rounded-lg border bg-black/40 p-3 font-mono text-xs leading-relaxed">
                {snippet}
              </pre>
              <CopyButton text={snippet} label="Copy snippet" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The admin key has not been issued yet. It appears here once the
              worker finishes provisioning.
            </p>
          )}
        </CardContent>
      </Card>

      <LogViewer slug={project.slug} />

      {canMutate && (
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <SubmitForm
                action={restartProject}
                label="Restart"
                variant="secondary"
                successText="Restart queued."
                className="[&>div]:mt-0"
              >
                <input type="hidden" name="slug" value={project.slug} />
              </SubmitForm>

              <SubmitForm
                action={rotateProjectKey}
                label="Rotate key"
                variant="secondary"
                successText="Key rotation queued."
                className="[&>div]:mt-0"
              >
                <input type="hidden" name="slug" value={project.slug} />
              </SubmitForm>

              <SubmitForm
                action={toggleProjectDashboard}
                label={project.dashboardEnabled ? "Disable dashboard" : "Enable dashboard"}
                variant="secondary"
                successText="Dashboard toggle queued."
                className="[&>div]:mt-0"
              >
                <input type="hidden" name="slug" value={project.slug} />
                <input
                  type="hidden"
                  name="enabled"
                  value={project.dashboardEnabled ? "false" : "true"}
                />
              </SubmitForm>
            </div>

            <div className="space-y-1">
              <h2 className="m-0 text-base font-medium">Update image</h2>
              <SubmitForm
                action={updateProjectImage}
                label="Update image"
                variant="secondary"
                successText="Image update queued."
                className="space-y-4"
              >
                <input type="hidden" name="slug" value={project.slug} />
                <div className="max-w-md space-y-2">
                  <Label htmlFor="backendImage">
                    Backend image (pin a REV)
                  </Label>
                  <Input
                    id="backendImage"
                    name="backendImage"
                    autoComplete="off"
                    defaultValue={project.backendImage}
                    required
                  />
                </div>
              </SubmitForm>
            </div>
          </CardContent>
        </Card>
      )}

      {canDelete && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Deleting stops and removes the containers. The project database is
              kept unless you also opt in to dropping it below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubmitForm
              action={deleteProject}
              label="Delete project"
              variant="danger"
              successText="Deletion queued."
              className="max-w-md space-y-4"
            >
              <input type="hidden" name="slug" value={project.slug} />
              <div className="space-y-2">
                <Label htmlFor="confirm">
                  Type{" "}
                  <code className="font-mono text-xs">{project.slug}</code> to
                  confirm
                </Label>
                <Input
                  id="confirm"
                  name="confirm"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <input
                  id="dropDb"
                  type="checkbox"
                  name="dropDb"
                  className="size-4 shrink-0 accent-[var(--err)]"
                />
                <Label htmlFor="dropDb" className="font-normal">
                  Also drop the project database (irreversible)
                </Label>
              </div>
            </SubmitForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ul className="m-0 divide-y p-0 text-sm">
              {events.map((event) => (
                <li
                  key={event.id}
                  className={
                    event.level === "error"
                      ? "list-none py-1.5 text-[var(--err)]"
                      : event.level === "warn"
                        ? "list-none py-1.5 text-[var(--warn)]"
                        : "list-none py-1.5 text-muted-foreground"
                  }
                >
                  <code className="font-mono text-xs">
                    {event.at.toISOString()}
                  </code>{" "}
                  <strong className="font-medium">{event.job}</strong>{" "}
                  {event.message}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
