import { cn } from "@/lib/utils";

/**
 * Deployment-status dot. Kept in app/components (not the generated ui/ dir)
 * because it maps domain state, not the shadcn palette. Colors follow
 * --ok/--warn/--err from globals.css so failures read red and healthy green.
 */
const STATUS_CLASS: Record<string, string> = {
  healthy: "bg-[var(--ok)]",
  pending: "bg-[var(--warn)]",
  provisioning: "bg-[var(--warn)]",
  degraded: "bg-[var(--warn)]",
  failed: "bg-[var(--err)]",
  deleting: "bg-[var(--err)]",
};

export function ProjectStatusDot({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full bg-muted-foreground",
        STATUS_CLASS[status],
        className,
      )}
    />
  );
}
