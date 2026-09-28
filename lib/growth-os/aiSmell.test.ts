import { describe, it, expect } from "vitest";
import { detectAiSmell, estimateAiSmellPenalty, type AiSmellFinding } from "./aiSmell";

function dummyFindings(count: number): AiSmellFinding[] {
  return Array.from({ length: count }, () => ({
    pattern: "dummy",
    location: "",
    reason: "",
    suggested_fix: "",
  }));
}

describe("detectAiSmell", () => {
  it("結論から言うとの多用を検出する", () => {
    const findings = detectAiSmell("結論から言うと、50代は今が動き時です。");
    expect(findings.some((f) => f.pattern === "結論から言うとの多用")).toBe(true);
  });

  it("重要なのは〜ですの型を検出する", () => {
    const findings = detectAiSmell("重要なのは行動することです。日々の積み重ねが大切です。");
    expect(findings.some((f) => f.pattern === "重要なのは〜ですの多用")).toBe(true);
  });

  it("自然な文章では何も検出しない", () => {
    const findings = detectAiSmell(
      "先週、久しぶりに元同僚と会った。彼はまだ迷っているようだった。私も同じだったから、その気持ちはよくわかる。"
    );
    expect(findings).toHaveLength(0);
  });

  it("箇条書きが大半を占める文章を過度な箇条書きとして検出する", () => {
    const text = ["- ポイント1", "- ポイント2", "- ポイント3", "- ポイント4", "- ポイント5", "- ポイント6"].join("\n");
    const findings = detectAiSmell(text);
    expect(findings.some((f) => f.pattern === "過度な箇条書き")).toBe(true);
  });
});

describe("estimateAiSmellPenalty", () => {
  it("検出件数に応じてペナルティが増えるが40で頭打ちになる", () => {
    expect(estimateAiSmellPenalty([])).toBe(0);
    expect(estimateAiSmellPenalty(dummyFindings(2))).toBe(16);
    expect(estimateAiSmellPenalty(dummyFindings(10))).toBe(40);
  });
});
