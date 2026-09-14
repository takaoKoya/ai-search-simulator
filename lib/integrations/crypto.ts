import crypto from "crypto";

/**
 * AES-256-GCM encryption at rest for OAuth tokens (spec §7): access/refresh
 * tokens must never be stored in plaintext. The key comes from
 * `TOKEN_ENCRYPTION_KEY` (a 64-character hex string = 32 bytes) — never
 * hardcoded, never derived from anything request-scoped or user-supplied.
 *
 * Callers must never log the plaintext this module returns, nor the stored
 * ciphertext string (it decrypts back to the literal access/refresh token) —
 * this applies to console.log, error logs, agent_events/decision_memories,
 * AI prompts, and any API response body without exception.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to encrypt/decrypt OAuth tokens");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Returns one self-contained string (`<iv>.<ciphertext+authTag>`, both
 * base64) so a single DB column (`encrypted_access_token` /
 * `encrypted_refresh_token`) is enough per token — no separate IV column to
 * keep in sync, and no risk of an IV meant for one token being reused to
 * decrypt another.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${Buffer.concat([encrypted, authTag]).toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const key = getKey();
  const [ivB64, payloadB64] = stored.split(".");
  if (!ivB64 || !payloadB64) throw new Error("Malformed encrypted token");

  const iv = Buffer.from(ivB64, "base64");
  const combined = Buffer.from(payloadB64, "base64");
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
