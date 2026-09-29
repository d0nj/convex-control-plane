"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Create-project form (client component).
 *
 * Posts to `POST /api/projects`, which validates the session, the team role
 * (admin/owner), and the slug, then inserts a `pending` row and enqueues
 * `project.create`. The form does no provisioning itself — it just reports the
 * enqueue result and refreshes the list.
 */
export function CreateProjectForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId,
        slug: form.get("slug"),
        displayName: form.get("displayName"),
      }),
    });
    setPending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Request failed (${res.status})`);
      return;
    }
    (event.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-44 flex-1 space-y-2">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          autoComplete="off"
          placeholder="my-app"
          pattern="[a-z][a-z0-9-]{1,61}"
          title="Lowercase letter, then lowercase letters, digits, or dashes (2-62 chars)."
          required
        />
      </div>
      <div className="min-w-44 flex-1 space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="off"
          placeholder="My App"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create project"}
      </Button>
      {error && (
        <Alert variant="destructive" className="basis-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
