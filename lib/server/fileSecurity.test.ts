import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateSignedFileToken, verifySignedFileToken } from "@/lib/server/fileSecurity";

beforeAll(() => {
  process.env.FILE_SIGNING_SECRET = "4".repeat(64);
});

describe("generateSignedFileToken / verifySignedFileToken", () => {
  it("round-trips: a freshly generated token verifies and returns the same fileId", () => {
    const { token } = generateSignedFileToken("file-123");
    const result = verifySignedFileToken(token);
    expect(result.valid).toBe(true);
    expect(result.fileId).toBe("file-123");
  });

  it("clamps ttlSeconds to the 5-30 minute window", () => {
    const tooShort = generateSignedFileToken("file-123", 10);
    const tooLong = generateSignedFileToken("file-123", 3600);
    const shortMinutes = (new Date(tooShort.expiresAt).getTime() - Date.now()) / 60000;
    const longMinutes = (new Date(tooLong.expiresAt).getTime() - Date.now()) / 60000;
    expect(shortMinutes).toBeGreaterThanOrEqual(4.9);
    expect(longMinutes).toBeLessThanOrEqual(30.1);
  });

  it("rejects a tampered token (fileId substitution)", () => {
    const { token } = generateSignedFileToken("file-123");
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(`file-456.${Date.now() + 600_000}`, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const forgedToken = `${forgedPayload}.${signature}`;
    expect(verifySignedFileToken(forgedToken).valid).toBe(false);
  });

  it("rejects a token with a bad signature", () => {
    const { token } = generateSignedFileToken("file-123");
    const [payload] = token.split(".");
    expect(verifySignedFileToken(`${payload}.not-a-real-signature`).valid).toBe(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a token once its expiry has passed", () => {
    const ttlSeconds = 300; // the library's own 5-minute minimum clamp
    const { token } = generateSignedFileToken("file-123", ttlSeconds);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (ttlSeconds + 60) * 1000);
    expect(verifySignedFileToken(token).valid).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(verifySignedFileToken("not-a-valid-token").valid).toBe(false);
    expect(verifySignedFileToken("").valid).toBe(false);
  });
});
