import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth-server";
import { listProjects } from "@/lib/projects";
import { getTeamBySlug, getTeamRole, isPlatformAdmin, isTeamSuspended } from "@/lib/teams";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateProjectForm } from "../../../components/CreateProjectForm";
import { ProjectStatusDot } from "../../../components/StatusDot";

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-xl font-semibold tracking-tight">
          {team.name} — projects
        </h1>
        <span className="ml-auto" />
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/teams/${team.slug}/settings`} />}
        >
          Team settings
        </Button>
      </div>

      {suspended && (
        <Alert variant="destructive">
          <AlertTitle>Team suspended</AlertTitle>
          <AlertDescription>
            This team is suspended. New projects cannot be created until a
            platform admin lifts the suspension.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          {projects.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No projects yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>API URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1.5 capitalize">
                        <ProjectStatusDot status={project.status} />
                        {project.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${project.slug}`}>
                        {project.displayName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">{project.slug}</code>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      {project.apiUrl ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canMutate && !suspended && (
        <Card>
          <CardHeader>
            <CardTitle>Create project</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateProjectForm teamId={team.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
