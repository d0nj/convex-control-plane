import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "../src/secrets.js";

// SECRETS_KEY must be base64 of EXACTLY 32 bytes; value 7 per the brief.
const VALID_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SECRETS_KEY = VALID_KEY;

describe("secret encryption", () => {
  it("round-trips plaintext through encrypt then decrypt", () => {
    expect(decryptSecret(encryptSecret("instance-secret-value"))).toBe(
      "instance-secret-value",
    );
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
});

describe("secret encryption guards", () => {
  // These tests mutate SECRETS_KEY; restore the valid vector afterwards so the
  // happy-path suite above is unaffected regardless of execution order.
  beforeEach(() => {
    process.env.SECRETS_KEY = VALID_KEY;
  });
  afterEach(() => {
    process.env.SECRETS_KEY = VALID_KEY;
  });

  it("throws when SECRETS_KEY is not set", () => {
    delete process.env.SECRETS_KEY;
    expect(() => encryptSecret("x")).toThrow();
  });

  it("throws when SECRETS_KEY is not 32 bytes", () => {
    process.env.SECRETS_KEY = Buffer.alloc(31, 7).toString("base64");
    expect(() => encryptSecret("x")).toThrow();
  });

  it("throws when SECRETS_KEY is not canonical base64", () => {
    process.env.SECRETS_KEY = "!!!not base64!!!";
    expect(() => encryptSecret("x")).toThrow();
  });

  it("throws on a ciphertext without three dot-separated segments", () => {
    expect(() => decryptSecret("only.two")).toThrow();
  });

  it("throws on a ciphertext with a bad IV length", () => {
    const [, tag, body] = encryptSecret("x").split(".");
    const shortIv = Buffer.alloc(8).toString("base64");
    expect(() => decryptSecret([shortIv, tag, body].join("."))).toThrow();
  });

  it("throws when the auth tag is tampered with", () => {
    const [iv, tag, body] = encryptSecret("x").split(".");
    const flipped = Buffer.from(tag!, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() =>
      decryptSecret([iv, flipped.toString("base64"), body].join(".")),
    ).toThrow();
  });
});
