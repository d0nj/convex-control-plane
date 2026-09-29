"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLineIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  TerminalIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** One decoded SSE log frame from the worker logs endpoint. */
export interface LogEntry {
  id: number;
  ts: string;
  stream: "stdout" | "stderr";
  line: string;
}

type Target = "backend" | "dashboard";
type Tail = "100" | "500" | "1000";

const TAIL_OPTIONS: Tail[] = ["100", "500", "1000"];
const MAX_ENTRIES = 2000;

function parseFrame(raw: string): Omit<LogEntry, "id"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { ts, stream, line } = parsed as Record<string, unknown>;
  if (typeof ts !== "string" || typeof line !== "string") return null;
  return {
    ts,
    stream: stream === "stderr" ? "stderr" : "stdout",
    line,
  };
}

/** Level coloring: stderr is tinted; error/exception/warn stand out. */
function lineClass(entry: LogEntry): string {
  const haystack = ` ${entry.line.toLowerCase()}`;
  if (
    haystack.includes("exception") ||
    haystack.includes("panic") ||
    haystack.includes("fatal") ||
    haystack.includes(" error ") ||
    haystack.includes("error:") ||
    haystack.includes("failed")
  ) {
    return "text-[var(--err)]";
  }
  if (haystack.includes("warn")) {
    return "text-[var(--warn)]";
  }
  if (entry.stream === "stderr") {
    return "text-orange-200/90";
  }
  return "text-muted-foreground";
}

/**
 * Live container-log viewer (client component).
 *
 * Streams `GET /api/projects/<slug>/logs` with fetch + a reader (not
 * EventSource) so pause/resume and custom frame parsing are possible. The
 * follow toggle disconnects the stream entirely; changing tail/target
 * reconnects. Auto-scroll sticks to the bottom only while following and the
 * user is already near the bottom, so reading history never jumps.
 */
export function LogViewer({ slug }: { slug: string }) {
  const [target, setTarget] = useState<Target>("backend");
  const [tail, setTail] = useState<Tail>("100");
  const [following, setFollowing] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const idRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const append = useCallback((parsed: Omit<LogEntry, "id">) => {
    const entry: LogEntry = { ...parsed, id: idRef.current++ };
    setEntries((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_ENTRIES
        ? next.slice(next.length - MAX_ENTRIES)
        : next;
    });
  }, []);

  useEffect(() => {
    if (!following) return;
    const controller = new AbortController();
    let cancelled = false;

    async function run() {
      setStatus("idle");
      setError(null);
      setEntries([]);
      idRef.current = 0;
      try {
        const params = new URLSearchParams({ target, tail, follow: "1" });
        const res = await fetch(`/api/projects/${slug}/logs?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `Log stream failed (${res.status})`);
        }
        if (cancelled) return;
        setStatus("live");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            for (const eventLine of chunk.split("\n")) {
              const trimmed = eventLine.trim();
              if (!trimmed.startsWith("data:")) continue;
              const parsed = parseFrame(trimmed.slice("data:".length).trim());
              if (parsed) append(parsed);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Log stream failed");
      }
    }

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug, target, tail, following, append]);

  // Sticky auto-scroll: only force the bottom while following and already near
  // it, so scrolling up to read history is never yanked away.
  useEffect(() => {
    if (!following || !stickRef.current) return;
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [entries, following]);

  function onScroll() {
    const el = viewportRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  function scrollToBottom() {
    stickRef.current = true;
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <TerminalIcon aria-hidden className="size-4" />
              Logs
            </CardTitle>
            <CardDescription>
              Live container output, newest at the bottom.
            </CardDescription>
          </div>
          <span className="ml-auto" />
          <Badge
            variant={status === "error" ? "destructive" : "secondary"}
            aria-live="polite"
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                status === "live"
                  ? "bg-[var(--ok)]"
                  : status === "error"
                    ? "bg-[var(--err)]"
                    : "bg-muted-foreground",
              )}
            />
            {status === "live"
              ? "live"
              : status === "error"
                ? "error"
                : "connecting"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div className="space-y-1.5">
            <label
              htmlFor={`logs-target-${slug}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Container
            </label>
            <Select
              value={target}
              onValueChange={(value: string | null) =>
                setTarget(value === "dashboard" ? "dashboard" : "backend")
              }
            >
              <SelectTrigger id={`logs-target-${slug}`} size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="backend">backend</SelectItem>
                <SelectItem value="dashboard">dashboard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`logs-tail-${slug}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Tail
            </label>
            <Select
              value={tail}
              onValueChange={(value: string | null) =>
                setTail(
                  value === "500" || value === "1000"
                    ? value
                    : ("100" as Tail),
                )
              }
            >
              <SelectTrigger id={`logs-tail-${slug}`} size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAIL_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option} lines
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setFollowing((prev) => !prev)}
            aria-pressed={following}
          >
            {following ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
            {following ? "Pause" : "Follow"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={scrollToBottom}>
            <ArrowDownToLineIcon aria-hidden />
            Bottom
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFollowing(true)}
              >
                <RefreshCwIcon aria-hidden />
                Reconnect
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <div
          ref={viewportRef}
          onScroll={onScroll}
          role="log"
          aria-label={`Container logs for ${slug}`}
          tabIndex={0}
          className="h-96 overflow-y-auto rounded-lg border bg-black/40 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {entries.length === 0 ? (
            <p className="font-sans text-sm text-muted-foreground">
              {status === "error" ? "No lines received." : "Waiting for log lines…"}
            </p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex gap-2 whitespace-pre-wrap break-all"
              >
                <span className="shrink-0 text-muted-foreground/60">{entry.ts}</span>
                <span className={cn("min-w-0 flex-1", lineClass(entry))}>
                  {entry.line}
                </span>
              </div>
            ))
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {entries.length} line{entries.length === 1 ? "" : "s"} buffered
          {following ? " · following" : " · paused"} ·{" "}
          {target === "dashboard" ? `convex-dash-${slug}` : `convex-${slug}`}
        </p>
      </CardContent>
    </Card>
  );
}
