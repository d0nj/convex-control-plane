import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { createLogDemux } from "./docker.js";
import type { LogLine, LogsClient } from "./docker.js";

/**
 * Internal container-log streaming endpoint (Server-Sent Events).
 *
 * Only the worker mounts the Docker socket, so the web app — which has no
 * socket — proxies authenticated browser streams to this endpoint over the
 * internal compose network. This module is the worker-side half: it maps a
 * container name to an SSE stream of that container's stdout/stderr.
 *
 * INTERNAL-ONLY: this endpoint performs NO authentication or authorization. It
 * must therefore never be published. Concretely: `infra/compose.yml` declares no
 * `ports:` entry for the `worker` service, and this module carries no Traefik
 * labels, so nothing can route to it from outside the compose network. It binds
 * `0.0.0.0` solely so peers on the internal network can reach it — the web layer
 * authorizes the browser first and is the only intended client.
 *
 * Log-line contents are data: they are streamed through verbatim and never
 * logged server-side. Errors surfaced to a client carry Docker's message only,
 * never a secret value.
 */

/** Injectable dependency: the Docker surface the endpoint needs. */
export interface LogsServerDeps {
  /** The real {@link DockerApi} satisfies this; tests pass a fake. */
  docker: LogsClient;
}

/** Construction options. `port` defaults to `WORKER_LOGS_PORT`, then `8080`. */
export interface LogsServerOptions {
  port?: number;
}

/** A running logs server. */
export interface LogsServer {
  /** Bound origin, e.g. `http://0.0.0.0:8080`. */
  url: string;
  /** Resolves once the socket is bound (needed when `port: 0` is used). */
  ready: Promise<void>;
  /** Stop listening and force-close any in-flight `follow` streams. */
  close: () => Promise<void>;
}

/** Container name: a leading alphanumeric, then alphanumerics/`_.-`. */
const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]+$/;
/** `GET /logs/<name>` — the captured group is the raw (still-encoded) name. */
const LOGS_PATH_RE = /^\/logs\/([^/]+)$/;
const DEFAULT_TAIL = 200;
const MIN_TAIL = 1;
const MAX_TAIL = 2000;
const DEFAULT_PORT = 8080;
/** Heartbeat comment cadence for `follow` streams (cleared on disconnect). */
const HEARTBEAT_MS = 15_000;

/**
 * Backpressure bound: at most this many decoded lines are buffered for a slow
 * client. When the socket buffer is full the queue grows; past this cap the
 * OLDEST line is dropped (a live log stream is "latest wins") and the drop count
 * is surfaced to the client as an `event: dropped` notice with
 * `data: {"dropped":n}`. This keeps worker memory bounded no matter how far a
 * consumer falls behind.
 */
const MAX_QUEUE = 1000;

/** Parse and bound the `tail` query parameter. Returns `null` when invalid. */
export function parseTail(raw: string | null): number | null {
  if (raw === null) return DEFAULT_TAIL;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (value < MIN_TAIL || value > MAX_TAIL) return null;
  return value;
}

/** `follow=0` dumps the tail and closes; anything else (incl. absent) follows. */
export function parseFollow(raw: string | null): boolean {
  return raw !== "0";
}

/** One SSE `data:` frame carrying a log line. */
function lineFrame(line: LogLine): string {
  return `data: ${JSON.stringify(line)}\n\n`;
}

/** Final `event: error` frame; carries Docker's message only. */
function errorFrame(message: string): string {
  return `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
}

/** Write a JSON body with the given status code. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Stream one container's logs as SSE until the source ends or the client
 * disconnects. Headers are written only after Docker accepts the request, so a
 * missing container yields a clean 404 JSON body instead of a half-open stream.
 */
function handleLogs(
  deps: LogsServerDeps,
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  tail: number,
  follow: boolean,
): void {
  let done = false;
  let headersSent = false;
  let endRequested = false;
  let source: { destroy: () => void } | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  const queue: LogLine[] = [];
  let dropped = 0;

  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    // Client (browser -> web proxy) went away: tear the Docker stream down now,
    // otherwise a `follow` stream would leak for the container's lifetime.
    source?.destroy();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);

  /** End the response once the queue has fully drained. */
  const maybeEnd = (): void => {
    if (done) return;
    if (endRequested && queue.length === 0 && dropped === 0) {
      cleanup();
      res.end();
    }
  };

  /**
   * Write as many queued frames as the socket will take. `res.write()` returning
   * `false` means "buffered, stop for now": we return and wait for `drain`,
   * leaving the rest queued (bounded by {@link MAX_QUEUE}).
   */
  const flush = (): void => {
    if (done || !headersSent) return;
    if (dropped > 0) {
      const n = dropped;
      dropped = 0;
      res.write(`event: dropped\ndata: ${JSON.stringify({ dropped: n })}\n\n`);
    }
    while (queue.length > 0) {
      const line = queue.shift() as LogLine;
      if (!res.write(lineFrame(line))) return;
    }
    maybeEnd();
  };

  const enqueue = (line: LogLine): void => {
    queue.push(line);
    if (queue.length > MAX_QUEUE) {
      queue.shift();
      dropped += 1;
    }
    flush();
  };

  res.on("drain", flush);

  const respondOpenError = (err: unknown): void => {
    if (done) return;
    const status = (err as { statusCode?: number } | null)?.statusCode;
    if (status === 404) {
      json(res, 404, { error: "no such container" });
    } else {
      const message = err instanceof Error ? err.message : "docker error";
      json(res, 500, { error: message });
    }
  };

  const open = (): void => {
    let raw: Buffer | NodeJS.ReadableStream;
    try {
      raw = deps.docker.getContainer(name).logs({
        follow,
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
      }) as unknown as Buffer | NodeJS.ReadableStream;
    } catch (err) {
      respondOpenError(err);
      return;
    }
    Promise.resolve(raw)
      .then((resolved) => {
        if (done) {
          (resolved as unknown as { destroy?: () => void }).destroy?.();
          return;
        }
        // Headers are written only now: a rejected promise (missing container)
        // is still reported as JSON, before any SSE bytes.
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.flushHeaders();
        headersSent = true;
        const demux = createLogDemux(resolved, enqueue);
        source = demux;
        demux.onEnd((err) => {
          if (done) return;
          if (err) {
            // Mid-stream failure: a final error event, then close.
            cleanup();
            res.write(errorFrame(err.message));
            res.end();
            return;
          }
          endRequested = true;
          flush();
          maybeEnd();
        });
        if (follow) {
          heartbeat = setInterval(() => {
            if (!done) res.write(": keep-alive\n\n");
          }, HEARTBEAT_MS);
          heartbeat.unref();
        }
      })
      .catch(respondOpenError);
  };

  open();
}

/** Route and validate one request. Exported for focused unit tests. */
export function handleRequest(
  deps: LogsServerDeps,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== "GET") {
    json(res, 405, { error: "method not allowed" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://internal");
  const match = LOGS_PATH_RE.exec(url.pathname);
  if (!match) {
    json(res, 404, { error: "not found" });
    return;
  }
  let name: string;
  try {
    name = decodeURIComponent(match[1] ?? "");
  } catch {
    json(res, 400, { error: "invalid container name" });
    return;
  }
  // Validate the name BEFORE touching Docker: a malformed name is a client
  // error, never a container lookup.
  if (!CONTAINER_NAME_RE.test(name)) {
    json(res, 400, { error: "invalid container name" });
    return;
  }
  const tail = parseTail(url.searchParams.get("tail"));
  if (tail === null) {
    json(res, 400, { error: "invalid tail" });
    return;
  }
  handleLogs(deps, req, res, name, tail, parseFollow(url.searchParams.get("follow")));
}

/**
 * Start the internal logs server. `deps.docker` is injected so tests pass a
 * fake; production passes the shared {@link DockerApi}.
 */
export function startLogsServer(
  deps: LogsServerDeps,
  opts: LogsServerOptions = {},
): LogsServer {
  const configuredPort =
    opts.port ?? (Number(process.env.WORKER_LOGS_PORT) || DEFAULT_PORT);
  const server: Server = createServer((req, res) => handleRequest(deps, req, res));
  const ready = new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  // 0.0.0.0: reachable from peer containers on the internal compose network
  // (the web proxy) — never published to the host (no compose `ports:`).
  server.listen(configuredPort, "0.0.0.0");
  return {
    // Read from the live socket so an ephemeral `port: 0` (tests) reports the
    // real port; falls back to the configured one before `listening`.
    get url() {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : configuredPort;
      return `http://0.0.0.0:${bound}`;
    },
    ready,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // `follow` streams never end on their own; force their sockets closed so
        // shutdown (and the SIGTERM drain) cannot hang.
        if (server.listening) server.closeAllConnections();
      }),
  };
}
