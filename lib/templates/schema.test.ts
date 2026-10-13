import { describe, expect, it } from "vitest";
import { templateInputSchema } from "./schema";

describe("templateInputSchema", () => {
  it("accepts shared (null/omitted jobId) and job-scoped templates", () => {
    expect(templateInputSchema.safeParse({ name: "標準", body: "本文" }).success).toBe(true);
    expect(templateInputSchema.safeParse({ name: "標準", body: "本文", jobId: null }).success).toBe(true);
    expect(templateInputSchema.safeParse({ name: "標準", body: "本文", jobId: "cabc" }).success).toBe(true);
  });
  it("rejects blank or oversized fields", () => {
    expect(templateInputSchema.safeParse({ name: " ", body: "x" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "a", body: "" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "a".repeat(51), body: "x" }).success).toBe(false);
  });
});
