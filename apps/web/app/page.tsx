import Link from "next/link";
import { redirect } from "next/navigation";

import { SubmitForm } from "./components/SubmitForm";
import { getSession } from "@/lib/auth-server";
import { listTeamsForUser } from "@/lib/teams";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTeam } from "./actions";

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
    <div className="space-y-4">
      <h1 className="m-0 text-xl font-semibold tracking-tight">
        Convex Control Plane
      </h1>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>No team yet</CardTitle>
          <CardDescription>
            You are signed in as {session.user.email}, but you are not a member
            of any team yet. Ask a team owner to invite you, or create a team
            below. Once you belong to a team its projects appear in the header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SubmitForm
            action={createTeam}
            label="Create team"
            successText="Team created."
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                name="name"
                autoComplete="organization"
                maxLength={128}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-slug">Slug (optional)</Label>
              <Input
                id="team-slug"
                name="slug"
                autoComplete="off"
                placeholder="my-team"
                pattern="[a-z][a-z0-9-]{1,61}"
                title="Lowercase letter, then lowercase letters, digits, or dashes (2-62 chars)."
              />
            </div>
          </SubmitForm>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin">Open the platform admin page</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
