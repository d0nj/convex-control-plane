"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard button.
 *
 * Takes the text as a prop so it can be used for the public URLs and for the
 * `.env.local` snippet. The snippet text is produced server-side; this component
 * only copies whatever it was handed and never stores it beyond the render.
 */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="secondary" type="button" onClick={copy}>
      {copied ? "Copied" : label}
    </button>
  );
}
