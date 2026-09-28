/**
 * Shared result shape for mutation server actions.
 *
 * Kept in a directive-free module so both the server actions (`"use server"`)
 * and the client form wrapper (`"use client"`) can import it without either
 * pulling the other across the client/server boundary.
 */
export type ActionState = { ok?: boolean; error?: string } | null;

/** The signature every mutation server action uses with `useActionState`. */
export type ServerAction = (
  state: ActionState,
  formData: FormData,
) => Promise<ActionState>;
