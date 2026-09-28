import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM secret encryption for per-project credentials at rest.
 *
 * Plaintext never reaches the database: callers store only the string
 * returned by {@link encryptSecret} and recover the value with
 * {@link decryptSecret}. Ciphertext layout is `ivB64.tagB64.bodyB64` — three
 * base64 segments joined by dots, so a value is self-describing and can be
 * versioned later by changing the segment count.
 *
 * The key comes from `SECRETS_KEY`: base64 of EXACTLY 32 bytes (256 bits).
 * Any other length is rejected at call time, never silently truncated.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Canonical base64 charset: standard alphabet, optional `=` padding only at the
 * end. Combined with the length and round-trip checks in {@link decodeB64} this
 * rejects the lenient inputs `Buffer.from(x, "base64")` would silently accept
 * (whitespace, URL-safe chars, bad padding, truncated groups).
 */
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Strictly decode base64 `value`, throwing on anything non-canonical. The
 * re-encode round-trip is the authoritative check: Node's decoder is lenient,
 * so comparing the canonical form back is what actually catches junk.
 */
function decodeB64(value: string, field: string): Buffer {
  if (value.length % 4 !== 0 || !B64_RE.test(value)) {
    throw new Error(`invalid base64 in ${field}`);
  }
  const buf = Buffer.from(value, "base64");
  if (buf.toString("base64") !== value) {
    throw new Error(`non-canonical base64 in ${field}`);
  }
  return buf;
}

/** Decode and validate `SECRETS_KEY`; throws unless it is 32 bytes of base64. */
function key(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    throw new Error("SECRETS_KEY is not set");
  }
  const buf = decodeB64(raw, "SECRETS_KEY");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_KEY must be base64 of exactly ${KEY_BYTES} bytes (got ${buf.length})`,
    );
  }
  return buf;
}

/** Encrypt UTF-8 plaintext to `ivB64.tagB64.bodyB64` with a fresh random IV. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(
    ".",
  );
}

/** Decrypt `ivB64.tagB64.bodyB64`; throws on malformed input or a bad tag. */
export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("malformed ciphertext: expected ivB64.tagB64.bodyB64");
  }
  const [ivB64, tagB64, bodyB64] = parts as [string, string, string];
  const iv = decodeB64(ivB64, "ciphertext iv");
  const tag = decodeB64(tagB64, "ciphertext tag");
  const body = decodeB64(bodyB64, "ciphertext body");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("malformed ciphertext: bad iv or tag length");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
