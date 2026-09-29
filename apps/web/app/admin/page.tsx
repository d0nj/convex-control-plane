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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="m-0 text-xl font-semibold tracking-tight">
          Platform admin
        </h1>
        <p className="text-sm text-muted-foreground">
          Suspend a team to stop it from creating new projects. Existing
          projects keep running.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>
            {rows.length === 0
              ? "No teams yet."
              : `${rows.length} team${rows.length === 1 ? "" : "s"} on this instance.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ team, members, suspended }) => (
                  <TableRow key={team.id}>
                    <TableCell>
                      <Link href={`/teams/${team.slug}/projects`}>
                        {team.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">{team.slug}</code>
                    </TableCell>
                    <TableCell>{members}</TableCell>
                    <TableCell>
                      <Badge variant={suspended ? "destructive" : "secondary"}>
                        {suspended ? "suspended" : "active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <SubmitForm
                        action={setSuspension}
                        label={suspended ? "Unsuspend" : "Suspend"}
                        variant={suspended ? "secondary" : "danger"}
                        successText="Updated."
                        className="[&>div]:mt-0"
                      >
                        <input type="hidden" name="teamId" value={team.id} />
                        <input
                          type="hidden"
                          name="suspend"
                          value={suspended ? "false" : "true"}
                        />
                      </SubmitForm>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
