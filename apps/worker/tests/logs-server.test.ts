import { afterEach, describe, expect, it } from "vitest";

import { startLogsServer } from "../src/logs-server.js";
import type { LogsServer } from "../src/logs-server.js";
import type { LogsClient } from "../src/docker.js";

/**
 * Unit tests for the internal SSE log-stream endpoint. NO Docker: the endpoint
 * takes the docker client as a parameter, so these inject a fake `LogsClient`
 * that returns hand-built Docker-multiplexed frames through the exact same
 * decode path production uses (`createLogDemux` in docker.ts).
 *
 * One assertion per test.
 */

/** Build one Docker multiplexed frame: `[stream(1)][0(3)][len(4 BE)][payload]`. */
function frame(streamByte: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header[0] = streamByte;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/** A docker fake returning `raw` for any container, recording whether it was hit. */
function fakeDocker(raw: Buffer | NodeJS.ReadableStream): {
  docker: LogsClient;
  touched: () => boolean;
} {
  let touched = false;
  return {
    docker: {
      getContainer() {
        touched = true;
        return { logs: () => Promise.resolve(raw) };
      },
    },
    touched: () => touched,
  };
}

let running: LogsServer | null = null;
afterEach(async () => {
  await running?.close().catch(() => {});
  running = null;
});

async function start(docker: LogsClient): Promise<LogsServer> {
  running = startLogsServer({ docker }, { port: 0 });
  await running.ready;
  return running;
}

describe("logs server", () => {
  it("rejects a bad container name with 400 without touching Docker", async () => {
    const fake = fakeDocker(Buffer.alloc(0));
    const server = await start(fake.docker);
    const res = await fetch(`${server.url}/logs/!!bad!!`);
    expect({ status: res.status, touched: fake.touched() }).toEqual({
      status: 400,
      touched: false,
    });
  });

  it("returns buffered lines as SSE data: frames then closes for follow=0", async () => {
    const raw = Buffer.concat([
      frame(1, "2024-01-02T03:04:05.000000000Z hello\n"),
      frame(2, "2024-01-02T03:04:06.000000000Z oops\n"),
    ]);
    const server = await start(fakeDocker(raw).docker);
    const res = await fetch(`${server.url}/logs/demo?follow=0`);
    expect(await res.text()).toBe(
      'data: {"ts":"2024-01-02T03:04:05.000Z","stream":"stdout","line":"hello"}\n\n' +
        'data: {"ts":"2024-01-02T03:04:06.000Z","stream":"stderr","line":"oops"}\n\n',
    );
  });

  it("emits a frame whose body parses as JSON with exactly ts/stream/line keys", async () => {
    const raw = frame(1, "2024-01-02T03:04:05.000000000Z hello\n");
    const server = await start(fakeDocker(raw).docker);
    const res = await fetch(`${server.url}/logs/demo?follow=0`);
    const body = await res.text();
    const payload = JSON.parse(body.slice("data: ".length)) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["line", "stream", "ts"]);
  });
});
