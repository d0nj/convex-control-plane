import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "../src/secrets.js";

// SECRETS_KEY must be base64 of EXACTLY 32 bytes; value 7 per the brief.
process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");

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
