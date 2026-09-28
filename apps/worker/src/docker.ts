import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";

import type {
  BackendContainerSpec,
  DashboardContainerSpec,
} from "@control/orchestrator";
import Docker from "dockerode";

/**
 * The worker's sole Docker surface. Everything that talks to the daemon lives
 * here; `jobs.ts` consumes this interface and never imports `dockerode` itself,
 * so the provisioning logic is injectable and the socket is confined to one
 * module.
 *
 * The socket path is a compile-time constant: the compose file mounts
 * `/var/run/docker.sock` into the worker read-write (the only service allowed
 * to do so) and nothing here ever accepts a path from a job payload.
 */
export const DOCKER_SOCKET_PATH = "/var/run/docker.sock";

/** Either spec the orchestrator can produce; both are valid create options. */
export type ContainerSpec = BackendContainerSpec | DashboardContainerSpec;

/** What the web UI shows for a project: inspect + a stats snapshot + recent logs. */
export interface ContainerDetails {
  inspect: Docker.ContainerInspectInfo;
  stats: Docker.ContainerStats | null;
  logs: string;
}

/** The subset of a Docker event this worker reacts to. */
export interface DockerEvent {
  status?: string;
  Action?: string;
  Type?: string;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
}

/** Docker surface consumed by the job handlers. */
export interface DockerApi {
  /**
   * Create-and-start `spec` if absent, reuse it if it already matches, or
   * recreate it when the image differs. Idempotent: safe to call on every
   * retry. Returns the container id.
   */
  ensureContainer(spec: ContainerSpec): Promise<string>;
  /** Run the in-container keygen and return the plaintext admin key (never log it). */
  execAdminKey(name: string): Promise<string>;
  /** Inspect + one-shot stats + recent logs, for display through the DB. */
  containerDetails(name: string): Promise<ContainerDetails>;
  /** Pull `image`, resolving only when the pull finishes. */
  pullImage(image: string): Promise<void>;
  /** Stop a container; a missing or already-stopped container is not an error. */
  stopContainer(name: string): Promise<void>;
  /** Force-remove a container; a missing container is not an error. */
  removeContainer(name: string): Promise<void>;
  /** Restart a container. */
  restartContainer(name: string): Promise<void>;
  /** The container's `/version` body, or `null` when it does not answer 2xx. */
  version(name: string): Promise<string | null>;
  /** Follow container events; resolves to an unsubscribe function. */
  watchEvents(onEvent: (event: DockerEvent) => void | Promise<void>): Promise<() => Promise<void>>;
  /** Release the dockerode client (no sockets are held open by default). */
  close(): void;
}

/** `true` when the error is Docker's "no such object" (HTTP 404). */
function isNotFound(err: unknown): boolean {
  return (err as { statusCode?: number } | null)?.statusCode === 404;
}

/**
 * Demux Docker's multiplexed stream framing: each frame is `[stream(1)][0(3)]
 * [length(4, BE)][payload]`. Falls back to a plain decode when the buffer is not
 * framed (e.g. a TTY container), so it never silently drops output.
 */
function demuxBuffer(buf: Buffer): string {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buf.length) break;
    chunks.push(buf.subarray(start, end));
    offset = end;
  }
  return chunks.length === 0
    ? buf.toString("utf8")
    : Buffer.concat(chunks).toString("utf8");
}

/** Build the worker's Docker API over the given socket (defaults to the mounted one). */
export function createDocker(options: { socketPath?: string } = {}): DockerApi {
  const docker = new Docker({
    socketPath: options.socketPath ?? DOCKER_SOCKET_PATH,
  });

  /** Collect a hijacked exec stream into separate stdout/stderr strings. */
  async function collect(
    stream: NodeJS.ReadableStream,
  ): Promise<{ stdout: string; stderr: string }> {
    const out = new PassThrough();
    const err = new PassThrough();
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    out.on("data", (c: Buffer) => outChunks.push(c));
    err.on("data", (c: Buffer) => errChunks.push(c));
    docker.modem.demuxStream(stream, out, err);
    await finished(stream);
    return {
      stdout: Buffer.concat(outChunks).toString("utf8"),
      stderr: Buffer.concat(errChunks).toString("utf8"),
    };
  }

  async function ensureContainer(spec: ContainerSpec): Promise<string> {
    const existing = docker.getContainer(spec.name);
    try {
      const info = await existing.inspect();
      if (info.Config.Image === spec.Image) {
        // Same image: only make sure it is running.
        if (!info.State.Running) await existing.start();
        return info.Id;
      }
      // Image changed (project.update): drop and recreate; the named volume
      // `<slug>-data` and the per-project database are untouched.
      await existing.remove({ force: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    const created = await docker.createContainer(
      spec as Docker.ContainerCreateOptions,
    );
    await created.start();
    return created.id;
  }

  async function execAdminKey(name: string): Promise<string> {
    const container = docker.getContainer(name);
    // `generate_admin_key.sh` sources read_credentials.sh, which takes
    // INSTANCE_SECRET/INSTANCE_NAME from the container env we set at create
    // time — so the secret is never placed on this process's argv.
    const exec = await container.exec({
      Cmd: ["./generate_admin_key.sh"],
      WorkingDir: "/convex",
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const { stdout, stderr } = await collect(stream);
    const inspected = await exec.inspect();
    if (inspected.ExitCode !== 0) {
      throw new Error(
        `generate_admin_key.sh exited ${inspected.ExitCode}: ${stderr.trim().slice(0, 200)}`,
      );
    }
    const adminKey = stdout.trim();
    if (!adminKey) {
      throw new Error("generate_admin_key.sh produced no admin key");
    }
    return adminKey;
  }

  async function containerDetails(name: string): Promise<ContainerDetails> {
    const container = docker.getContainer(name);
    const inspect = await container.inspect();
    let stats: Docker.ContainerStats | null = null;
    try {
      stats = await container.stats({ stream: false, "one-shot": true });
    } catch {
      // Stats can fail transiently (container just stopped); details still work.
    }
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail: 100,
    });
    return { inspect, stats, logs: demuxBuffer(logsBuffer) };
  }

  async function pullImage(image: string): Promise<void> {
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async function stopContainer(name: string): Promise<void> {
    try {
      await docker.getContainer(name).stop();
    } catch (err) {
      // 404 = already gone; 304 = already stopped. Both are idempotent no-ops.
      if (!isNotFound(err) && (err as { statusCode?: number }).statusCode !== 304) {
        throw err;
      }
    }
  }

  async function removeContainer(name: string): Promise<void> {
    try {
      await docker.getContainer(name).remove({ force: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async function restartContainer(name: string): Promise<void> {
    await docker.getContainer(name).restart();
  }

  async function version(name: string): Promise<string | null> {
    try {
      const res = await fetch(`http://${name}:3210/version`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return (await res.text()).trim();
    } catch {
      return null;
    }
  }

  async function watchEvents(
    onEvent: (event: DockerEvent) => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    const stream = await docker.getEvents({
      filters: { type: ["container"] },
    });
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            void onEvent(JSON.parse(line) as DockerEvent);
          } catch {
            // A malformed event line must never kill the listener.
          }
        }
        newline = buffer.indexOf("\n");
      }
    });
    return async () => {
      (stream as unknown as { destroy: () => void }).destroy();
    };
  }

  return {
    ensureContainer,
    execAdminKey,
    containerDetails,
    pullImage,
    stopContainer,
    removeContainer,
    restartContainer,
    version,
    watchEvents,
    close: () => {
      // dockerode holds no persistent connection; nothing to release.
    },
  };
}
