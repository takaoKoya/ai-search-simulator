import crypto from "crypto";

/**
 * Signed URLs for shared files (spec §48): private files must never get a
 * permanent public URL — only a short-lived (5-30 min), signature-verified
 * link. The signature is the security boundary here (there is no Supabase
 * Auth session for an external recipient to hold), so this must be
 * unforgeable without the server secret and must not accept an expired
 * token no matter how it got that way.
 */

const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes — within the spec's 5-30 min window
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 30 * 60;

function getSigningKey(): Buffer {
  const hex = process.env.FILE_SIGNING_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error("FILE_SIGNING_SECRET must be set to a 64-character hex string (32 bytes) to sign/verify file share links");
  }
  return Buffer.from(hex, "hex");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return base64url(crypto.createHmac("sha256", getSigningKey()).update(payload).digest());
}

export interface SignedFileToken {
  token: string;
  expiresAt: string;
}

/**
 * `ttlSeconds` is clamped to the spec's 5-30 minute window regardless of
 * what a caller passes — never silently trust a distant expiry.
 */
export function generateSignedFileToken(fileId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): SignedFileToken {
  const clampedTtl = Math.min(Math.max(ttlSeconds, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
  const expiresAtEpoch = Date.now() + clampedTtl * 1000;
  const payload = `${fileId}.${expiresAtEpoch}`;
  const token = `${base64url(Buffer.from(payload, "utf8"))}.${sign(payload)}`;
  return { token, expiresAt: new Date(expiresAtEpoch).toISOString() };
}

export interface VerifiedFileToken {
  valid: boolean;
  fileId?: string;
}

/**
 * Verifies a token's signature (constant-time comparison — never a plain
 * `===` on secret-derived data) and that it has not expired. Returns the
 * fileId only when both checks pass; callers must not use a fileId from an
 * invalid result.
 */
export function verifySignedFileToken(token: string): VerifiedFileToken {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { valid: false };

  const payload = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const expectedSignature = sign(payload);

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }

  const [fileId, expiresAtStr] = payload.split(".");
  const expiresAtEpoch = Number(expiresAtStr);
  if (!fileId || !Number.isFinite(expiresAtEpoch) || expiresAtEpoch < Date.now()) {
    return { valid: false };
  }

  return { valid: true, fileId };
}
