import { describe, expect, it } from "vitest";
import { buildScoringPrompt, parseScoreResult } from "./score";

describe("parseScoreResult", () => {
  it("accepts and rounds a valid result", () => {
    expect(parseScoreResult({ score: 72.4, evaluation: "良い", status: "PASSED" })).toEqual({
      score: 72,
      evaluation: "良い",
      status: "PASSED",
    });
  });
  it("rejects out-of-range scores, empty evaluation, and unknown status", () => {
    expect(parseScoreResult({ score: 101, evaluation: "x", status: "PASSED" })).toBeNull();
    expect(parseScoreResult({ score: 50, evaluation: "", status: "PASSED" })).toBeNull();
    expect(parseScoreResult({ score: 50, evaluation: "x", status: "HIRED" })).toBeNull();
  });
});

describe("buildScoringPrompt", () => {
  it("pairs each question with its answer", () => {
    const prompt = buildScoringPrompt({
      job: { title: "カフェ", location: "", salary: "", conditions: "", targetType: "ALBAIT", indeedText: "原稿" },
      questions: [{ question: "週何日?", options: ["2日", "3日"] }],
      answers: ["3日"],
      interviewAt: new Date("2026-10-20T05:00:00Z"),
    });
    expect(prompt).toContain("Q1. 週何日?");
    expect(prompt).toContain("回答: 3日");
    expect(prompt).toContain("勤務地: 未記載");
  });
});
