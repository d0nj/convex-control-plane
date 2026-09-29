"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import type { ActionState, ServerAction } from "@/lib/action-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * A form bound to a server action that shows inline success/failure and
 * disables its button while the action is in flight. `children` are the form
 * fields; `label` is the submit button text.
 */
export function SubmitForm({
  action,
  children,
  label,
  variant = "primary",
  className,
  successText = "Queued.",
}: {
  action: ServerAction;
  children?: ReactNode;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  successText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-3">
        <Button
          type="submit"
          variant={
            variant === "primary"
              ? "default"
              : variant === "danger"
                ? "destructive"
                : "secondary"
          }
          size="sm"
          disabled={pending}
        >
          {pending ? "Working…" : label}
        </Button>
      </div>
      {state?.error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state?.ok && (
        <p role="status" className="mt-2 text-sm text-[var(--ok)]">
          {successText}
        </p>
      )}
    </form>
  );
}
