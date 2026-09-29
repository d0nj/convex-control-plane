"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Copy-to-clipboard button.
 *
 * Takes the text as a prop so it can be used for the public URLs and for the
 * `.env.local` snippet. The snippet text is produced server-side; this component
 * only copies whatever it was handed and never stores it beyond the render.
 */
export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
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
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={copy}
      aria-live="polite"
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}
