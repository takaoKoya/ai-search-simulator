import { describe, it, expect } from "vitest";
import { recommendDailyIdeas, type RecommendationCandidate } from "./dailyRecommendation";

function candidate(overrides: Partial<RecommendationCandidate>): RecommendationCandidate {
  return {
    id: "id",
    title: "テスト",
    totalScore: 80,
    confidenceScore: 70,
    freshnessScore: 70,
    harmTypes: ["Ambition"],
    status: "NEW",
    ...overrides,
  };
}

describe("recommendDailyIdeas", () => {
  it("APPROVED/REJECTEDは候補から除外する", () => {
    const candidates = [
      candidate({ id: "a", status: "APPROVED" }),
      candidate({ id: "b", status: "REJECTED" }),
      candidate({ id: "c", status: "NEW" }),
    ];
    const result = recommendDailyIdeas(candidates, []);
    expect(result.map((r) => r.ideaId)).toEqual(["c"]);
  });

  it("スコア・信頼度・鮮度が高いものが上位に来る", () => {
    const candidates = [
      candidate({ id: "low", totalScore: 60, confidenceScore: 40, freshnessScore: 40 }),
      candidate({ id: "high", totalScore: 95, confidenceScore: 90, freshnessScore: 90 }),
    ];
    const result = recommendDailyIdeas(candidates, [], 3);
    expect(result[0].ideaId).toBe("high");
  });

  it("最大件数(limit)を超えない", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate({ id: `idea-${i}`, totalScore: 80 + i }));
    expect(recommendDailyIdeas(candidates, [], 3)).toHaveLength(3);
  });

  it("直近承認テーマが特定HARMに偏っている場合、同系統の候補は減点される", () => {
    const recentlyApproved = [
      candidate({ id: "h1", harmTypes: ["Money"] }),
      candidate({ id: "h2", harmTypes: ["Money"] }),
      candidate({ id: "h3", harmTypes: ["Money"] }),
    ];
    const sameHarm = candidate({ id: "same", totalScore: 85, harmTypes: ["Money"] });
    const otherHarm = candidate({ id: "other", totalScore: 85, harmTypes: ["Relation"] });

    const result = recommendDailyIdeas([sameHarm, otherHarm], recentlyApproved, 2);
    const sameResult = result.find((r) => r.ideaId === "same")!;
    const otherResult = result.find((r) => r.ideaId === "other")!;

    expect(sameResult.rankScore).toBeLessThan(otherResult.rankScore);
    expect(sameResult.reason).toContain("同系統");
  });

  it("候補が0件なら空配列を返す", () => {
    expect(recommendDailyIdeas([], [])).toEqual([]);
  });
});
