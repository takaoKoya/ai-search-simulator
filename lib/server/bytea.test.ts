import { describe, expect, it } from "vitest";
import { decodeBytea, encodeBytea } from "@/lib/server/bytea";

describe("encodeBytea / decodeBytea", () => {
  it("round-trips arbitrary binary data", () => {
    const original = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    const decoded = decodeBytea(encodeBytea(original));
    expect(decoded.equals(original)).toBe(true);
  });

  it("produces the standard Postgres hex-format prefix", () => {
    const encoded = encodeBytea(Buffer.from("AB", "utf8"));
    expect(encoded).toBe("\\x4142");
  });

  it("decodes a value without the \\x prefix as plain hex too", () => {
    expect(decodeBytea("4142").toString("utf8")).toBe("AB");
  });
});
