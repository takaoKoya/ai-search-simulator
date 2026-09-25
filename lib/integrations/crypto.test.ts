import { beforeAll, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a plaintext token", () => {
    const plaintext = "ya29.fake-access-token-value";
    const encrypted = decryptToken(encryptToken(plaintext));
    expect(encrypted).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV) even for the same plaintext", () => {
    const a = encryptToken("same-token");
    const b = encryptToken("same-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same-token");
    expect(decryptToken(b)).toBe("same-token");
  });

  it("never leaks the plaintext in the stored ciphertext string", () => {
    const plaintext = "super-secret-refresh-token";
    const stored = encryptToken(plaintext);
    expect(stored).not.toContain(plaintext);
  });

  it("throws on tampered ciphertext (auth tag mismatch)", () => {
    const stored = encryptToken("some-token");
    const [iv, payload] = stored.split(".");
    const flippedChar = payload[0] === "A" ? "B" : "A";
    const tamperedStored = `${iv}.${flippedChar}${payload.slice(1)}`;
    expect(() => decryptToken(tamperedStored)).toThrow();
  });

  it("throws when TOKEN_ENCRYPTION_KEY is missing or the wrong length", () => {
    const original = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => encryptToken("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    process.env.TOKEN_ENCRYPTION_KEY = original;
  });
});
