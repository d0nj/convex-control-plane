"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    <form className="inline" onSubmit={onSubmit}>
      <div>
        <label htmlFor="slug">Slug</label>
        <input
          id="slug"
          name="slug"
          placeholder="my-app"
          pattern="[a-z][a-z0-9-]{1,61}"
          title="Lowercase letter, then lowercase letters, digits, or dashes (2-62 chars)."
          required
        />
      </div>
      <div>
        <label htmlFor="displayName">Display name</label>
        <input id="displayName" name="displayName" placeholder="My App" />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create project"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
