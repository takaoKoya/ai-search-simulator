import { describe, it, expect } from "vitest";
import { computeConfidence, computeFreshnessScore, judgeIdea } from "./confidence";

describe("computeConfidence", () => {
  it("根拠十分・出典多様・鮮度高・AI自己申告高 なら高信頼度になる", () => {
    const c = computeConfidence({
      evidenceCount: 3,
      sourceCount: 2,
      freshnessScore: 100,
      aiSelfAssessedConfidence: 90,
    });
    expect(c).toBeGreaterThanOrEqual(90);
  });

  it("根拠ゼロなら信頼度は低くなる(AIの自己申告が高くても鵜呑みにしない)", () => {
    const c = computeConfidence({
      evidenceCount: 0,
      sourceCount: 0,
      freshnessScore: 0,
      aiSelfAssessedConfidence: 95,
    });
    // AI自己申告の重みは20%のみなので、根拠ゼロなら上限19点程度に抑えられる
    expect(c).toBeLessThan(30);
  });

  it("根拠件数は3件で頭打ちになる(4件でも3件と同じ扱い)", () => {
    const base = { sourceCount: 2, freshnessScore: 50, aiSelfAssessedConfidence: 50 };
    const at3 = computeConfidence({ ...base, evidenceCount: 3 });
    const at10 = computeConfidence({ ...base, evidenceCount: 10 });
    expect(at3).toBe(at10);
  });

  it("0-100の範囲に収まる", () => {
    const c = computeConfidence({ evidenceCount: 100, sourceCount: 100, freshnessScore: 100, aiSelfAssessedConfidence: 100 });
    expect(c).toBeLessThanOrEqual(100);
  });
});

describe("computeFreshnessScore", () => {
  it("収集日が今日なら100点に近い", () => {
    const now = new Date("2026-09-21T00:00:00Z");
    expect(computeFreshnessScore([now], now)).toBe(100);
  });

  it("収集日が古いほどスコアが下がるが、20点を下回らない", () => {
    const now = new Date("2026-09-21T00:00:00Z");
    const oneYearAgo = new Date("2025-09-21T00:00:00Z");
    const score = computeFreshnessScore([oneYearAgo], now);
    expect(score).toBe(20);
  });

  it("複数の日付がある場合は最も新しいものを採用する", () => {
    const now = new Date("2026-09-21T00:00:00Z");
    const old = new Date("2025-01-01T00:00:00Z");
    const recent = new Date("2026-09-20T00:00:00Z");
    expect(computeFreshnessScore([old, recent], now)).toBe(computeFreshnessScore([recent], now));
  });

  it("日付が1件もなければ0", () => {
    expect(computeFreshnessScore([])).toBe(0);
  });
});

describe("judgeIdea", () => {
  it("総合92点・信頼度87%なら有力候補", () => {
    expect(judgeIdea(92, 87)).toBe("STRONG_CANDIDATE");
  });

  it("総合92点・信頼度42%なら高得点だが根拠不足", () => {
    expect(judgeIdea(92, 42)).toBe("HIGH_SCORE_LOW_EVIDENCE");
  });

  it("総合70点・信頼度80%なら根拠は強いが優先度は中程度", () => {
    expect(judgeIdea(70, 80)).toBe("SOLID_BUT_LOW_PRIORITY");
  });

  it("総合60点・信頼度30%なら判断材料不足", () => {
    expect(judgeIdea(60, 30)).toBe("INSUFFICIENT_DATA");
  });
});
