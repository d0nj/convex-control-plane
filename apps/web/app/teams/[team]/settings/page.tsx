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
    <>
      <h1>{team.name} — settings</h1>
      <p className="muted">
        Your role: <strong>{role ?? "platform admin"}</strong>
      </p>

      <div className="panel">
        <h2>Members</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              {isOwner && <th>Change role</th>}
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.memberId}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.role}</td>
                {isOwner && (
                  <td>
                    <SubmitForm
                      action={updateMemberRole}
                      label="Save"
                      variant="secondary"
                      successText="Role updated."
                    >
                      <input type="hidden" name="team" value={team.slug} />
                      <input type="hidden" name="teamId" value={team.id} />
                      <input type="hidden" name="memberId" value={member.memberId} />
                      <select name="role" defaultValue={member.role}>
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        <option value="owner">owner</option>
                      </select>
                    </SubmitForm>
                  </td>
                )}
                {isAdmin && (
                  <td>
                    <SubmitForm
                      action={removeMember}
                      label="Remove"
                      variant="danger"
                      successText="Member removed."
                    >
                      <input type="hidden" name="team" value={team.slug} />
                      <input type="hidden" name="teamId" value={team.id} />
                      <input
                        type="hidden"
                        name="memberIdOrEmail"
                        value={member.memberId}
                      />
                    </SubmitForm>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="panel">
          <h2>Invite a member</h2>
          <SubmitForm
            action={inviteMember}
            label="Send invitation"
            successText="Invitation sent."
          >
            <input type="hidden" name="team" value={team.slug} />
            <input type="hidden" name="teamId" value={team.id} />
            <div>
              <label htmlFor="invite-email">Email</label>
              <input id="invite-email" name="email" type="email" required />
            </div>
            <div>
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" name="role" defaultValue="member">
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            </div>
          </SubmitForm>

          {pendingInvites.length > 0 && (
            <>
              <h2>Pending invitations</h2>
              <table>
                <tbody>
                  {pendingInvites.map((invite) => (
                    <tr key={invite.id}>
                      <td>{invite.email}</td>
                      <td>{invite.role ?? "member"}</td>
                      <td>
                        <SubmitForm
                          action={cancelInvitation}
                          label="Cancel"
                          variant="secondary"
                          successText="Invitation cancelled."
                        >
                          <input type="hidden" name="team" value={team.slug} />
                          <input type="hidden" name="teamId" value={team.id} />
                          <input
                            type="hidden"
                            name="invitationId"
                            value={invite.id}
                          />
                        </SubmitForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {isOwner && (
        <div className="panel">
          <h2>Single sign-on (OIDC)</h2>
          <p className="muted">
            Register an OIDC provider for this team. Users whose email matches
            the domain are routed to it from the sign-in page.
          </p>
          <SubmitForm
            action={registerSsoProvider}
            label="Register provider"
            successText="SSO provider registered."
          >
            <input type="hidden" name="team" value={team.slug} />
            <input type="hidden" name="teamId" value={team.id} />
            <div>
              <label htmlFor="sso-domain">Email domain</label>
              <input id="sso-domain" name="domain" placeholder="example.com" required />
            </div>
            <div>
              <label htmlFor="sso-issuer">Issuer URL</label>
              <input
                id="sso-issuer"
                name="issuer"
                type="url"
                placeholder="https://idp.example.com"
                required
              />
            </div>
            <div>
              <label htmlFor="sso-client-id">Client ID</label>
              <input id="sso-client-id" name="clientId" required />
            </div>
            <div>
              <label htmlFor="sso-client-secret">Client secret</label>
              <input id="sso-client-secret" name="clientSecret" type="password" />
            </div>
          </SubmitForm>
        </div>
      )}

      {isOwner && (
        <div className="panel">
          <h2>Danger zone</h2>
          <p className="muted">
            Deleting the team removes its members and invitations. Projects must
            be deleted individually first.
          </p>
          <SubmitForm
            action={deleteTeam}
            label="Delete team"
            variant="danger"
            successText="Team deleted."
          >
            <input type="hidden" name="team" value={team.slug} />
            <input type="hidden" name="teamId" value={team.id} />
            <div>
              <label htmlFor="delete-team-confirm">
                Type <code>{team.slug}</code> to confirm
              </label>
              <input
                id="delete-team-confirm"
                name="confirm"
                autoComplete="off"
                required
              />
            </div>
          </SubmitForm>
        </div>
      )}
    </>
  );
}
