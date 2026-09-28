"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import type { ActionState, ServerAction } from "@/lib/action-state";

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
      <button
        type="submit"
        className={variant === "primary" ? undefined : variant}
        disabled={pending}
      >
        {pending ? "Working…" : label}
      </button>
      {state?.error && <p className="error-text">{state.error}</p>}
      {state?.ok && <p className="ok-text">{successText}</p>}
    </form>
  );
}
