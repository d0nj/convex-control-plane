"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

/** Sign-out control for the header. Clears the session then returns to /sign-in. */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button
      className="secondary"
      type="button"
      onClick={signOut}
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
