import { describe, expect, it } from "vitest";
import { generatedJobSchema, generateJobInputSchema } from "./schema";

const valid = {
  targetType: "ALBAIT",
  snsPostText: { x: "x", instagram: "i", line: "l" },
  indeedText: "【仕事内容】",
  lineQuestions: Array.from({ length: 3 }, () => ({ question: "Q", options: ["A", "B"] })),
};

describe("generatedJobSchema", () => {
  it("accepts a valid result", () => {
    expect(generatedJobSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects unknown targetType and wrong question count", () => {
    expect(generatedJobSchema.safeParse({ ...valid, targetType: "X" }).success).toBe(false);
    expect(generatedJobSchema.safeParse({ ...valid, lineQuestions: valid.lineQuestions.slice(0, 2) }).success).toBe(false);
  });
});

describe("generateJobInputSchema", () => {
  it("rejects too-short text", () => {
    expect(generateJobInputSchema.safeParse({ text: "短い" }).success).toBe(false);
  });
});
