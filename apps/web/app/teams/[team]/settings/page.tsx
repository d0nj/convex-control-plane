import { notFound, redirect } from "next/navigation";

import { SubmitForm } from "../../../components/SubmitForm";
import { getSession } from "@/lib/auth-server";
import {
  getTeamBySlug,
  getTeamRole,
  isPlatformAdmin,
  listTeamInvitations,
  listTeamMembers,
} from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelInvitation,
  deleteTeam,
  inviteMember,
  registerSsoProvider,
  removeMember,
  updateMemberRole,
} from "./actions";

/**
 * `/teams/[team]/settings` — members, invitations, SSO, and danger zone
 * (design §4). Visible to any member; the mutation controls are gated by role
 * (invites/removal = admin, role changes + SSO + delete = owner) and the server
 * actions enforce the same rules.
 */
export default async function TeamSettingsPage({
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

  const isAdmin = platformAdmin || role === "admin" || role === "owner";
  const isOwner = platformAdmin || role === "owner";

  const [members, invitations] = await Promise.all([
    listTeamMembers(team.id),
    listTeamInvitations(team.id),
  ]);
  const pendingInvites = invitations.filter((i) => i.status === "pending");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="m-0 text-xl font-semibold tracking-tight">
          {team.name} — settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Your role:{" "}
          <Badge variant="outline" className="ml-1 capitalize">
            {role ?? "platform admin"}
          </Badge>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {isOwner && <TableHead>Change role</TableHead>}
                {isAdmin && (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.memberId}>
                  <TableCell>{member.name}</TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell className="capitalize">{member.role}</TableCell>
                  {isOwner && (
                    <TableCell>
                      <SubmitForm
                        action={updateMemberRole}
                        label="Save"
                        variant="secondary"
                        successText="Role updated."
                        className="flex items-end gap-2 [&>div]:mt-0"
                      >
                        <input type="hidden" name="team" value={team.slug} />
                        <input type="hidden" name="teamId" value={team.id} />
                        <input
                          type="hidden"
                          name="memberId"
                          value={member.memberId}
                        />
                        <select
                          name="role"
                          defaultValue={member.role}
                          aria-label={`Role for ${member.email}`}
                          className="h-8 w-auto min-w-28 rounded-2xl border border-transparent bg-input/50 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>
                      </SubmitForm>
                    </TableCell>
                  )}
                  {isAdmin && (
                    <TableCell className="text-right">
                      <SubmitForm
                        action={removeMember}
                        label="Remove"
                        variant="danger"
                        successText="Member removed."
                        className="[&>div]:mt-0"
                      >
                        <input type="hidden" name="team" value={team.slug} />
                        <input type="hidden" name="teamId" value={team.id} />
                        <input
                          type="hidden"
                          name="memberIdOrEmail"
                          value={member.memberId}
                        />
                      </SubmitForm>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <SubmitForm
              action={inviteMember}
              label="Send invitation"
              successText="Invitation sent."
              className="space-y-4"
            >
              <input type="hidden" name="team" value={team.slug} />
              <input type="hidden" name="teamId" value={team.id} />
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  name="role"
                  defaultValue="member"
                  className="h-8 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              </div>
            </SubmitForm>

            {pendingInvites.length > 0 && (
              <div className="space-y-2">
                <h2 className="m-0 text-base font-medium">
                  Pending invitations
                </h2>
                <Table>
                  <TableBody>
                    {pendingInvites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell className="capitalize">
                          {invite.role ?? "member"}
                        </TableCell>
                        <TableCell className="text-right">
                          <SubmitForm
                            action={cancelInvitation}
                            label="Cancel"
                            variant="secondary"
                            successText="Invitation cancelled."
                            className="[&>div]:mt-0"
                          >
                            <input type="hidden" name="team" value={team.slug} />
                            <input type="hidden" name="teamId" value={team.id} />
                            <input
                              type="hidden"
                              name="invitationId"
                              value={invite.id}
                            />
                          </SubmitForm>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Single sign-on (OIDC)</CardTitle>
            <CardDescription>
              Register an OIDC provider for this team. Users whose email matches
              the domain are routed to it from the sign-in page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubmitForm
              action={registerSsoProvider}
              label="Register provider"
              successText="SSO provider registered."
              className="space-y-4"
            >
              <input type="hidden" name="team" value={team.slug} />
              <input type="hidden" name="teamId" value={team.id} />
              <div className="space-y-2">
                <Label htmlFor="sso-domain">Email domain</Label>
                <Input
                  id="sso-domain"
                  name="domain"
                  autoComplete="off"
                  placeholder="example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sso-issuer">Issuer URL</Label>
                <Input
                  id="sso-issuer"
                  name="issuer"
                  type="url"
                  autoComplete="url"
                  placeholder="https://idp.example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sso-client-id">Client ID</Label>
                <Input
                  id="sso-client-id"
                  name="clientId"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sso-client-secret">Client secret</Label>
                <Input
                  id="sso-client-secret"
                  name="clientSecret"
                  type="password"
                  autoComplete="new-password"
                />
              </div>
            </SubmitForm>
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Deleting the team removes its members and invitations. Projects
              must be deleted individually first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubmitForm
              action={deleteTeam}
              label="Delete team"
              variant="danger"
              successText="Team deleted."
              className="space-y-4"
            >
              <input type="hidden" name="team" value={team.slug} />
              <input type="hidden" name="teamId" value={team.id} />
              <div className="space-y-2">
                <Label htmlFor="delete-team-confirm">
                  Type{" "}
                  <code className="font-mono text-xs">{team.slug}</code> to
                  confirm
                </Label>
                <Input
                  id="delete-team-confirm"
                  name="confirm"
                  autoComplete="off"
                  required
                />
              </div>
            </SubmitForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
