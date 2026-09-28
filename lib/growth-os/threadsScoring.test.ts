import { describe, it, expect } from "vitest";
import { computeThreadsScoreColumns, summarizeFailingCriteria } from "./threadsScoring";
import { meetsThreadsQualityBar } from "./types";
import type { ThreadsScoreResponse } from "./ai/schemas";

function scoreResponse(overrides: Partial<Record<string, number>>): ThreadsScoreResponse {
  const base: Record<string, number> = {
    hook: 85,
    empathy: 85,
    humanity: 85,
    clarity: 85,
    shareability: 85,
    sales_smell: 10,
    ai_smell: 10,
    preachiness: 10,
    fear: 10,
    ...overrides,
  };
  return {
    scores: Object.entries(base).map(([criterion, score]) => ({
      criterion: criterion as ThreadsScoreResponse["scores"][number]["criterion"],
      score,
      reason: `${criterion}の理由`,
    })),
  };
}

describe("computeThreadsScoreColumns", () => {
  it("良い軸が高く悪い軸が低い投稿はoverall_scoreが高くなり、品質基準を満たす", () => {
    const columns = computeThreadsScoreColumns(scoreResponse({}));
    expect(columns.overall_score).toBeGreaterThanOrEqual(80);
    expect(meetsThreadsQualityBar(columns)).toBe(true);
  });

  it("AI臭が強い投稿はoverall_scoreが下がり、品質基準を満たさない", () => {
    const columns = computeThreadsScoreColumns(scoreResponse({ ai_smell: 90, sales_smell: 80 }));
    expect(meetsThreadsQualityBar(columns)).toBe(false);
  });

  it("overall_scoreは0〜100にクランプされる", () => {
    const columns = computeThreadsScoreColumns(
      scoreResponse({ hook: 0, empathy: 0, humanity: 0, clarity: 0, shareability: 0, ai_smell: 100, sales_smell: 100 })
    );
    expect(columns.overall_score).toBeGreaterThanOrEqual(0);
    expect(columns.overall_score).toBeLessThanOrEqual(100);
  });

  it("AIの自己申告そのままではなく、9軸から機械的に算出する(overall軸は入力に無い)", () => {
    const response = scoreResponse({});
    expect(response.scores.some((s) => (s.criterion as string) === "overall")).toBe(false);
    const columns = computeThreadsScoreColumns(response);
    expect(typeof columns.overall_score).toBe("number");
  });
});

describe("summarizeFailingCriteria", () => {
  it("基準を満たしていれば改善促進の一般文を返す", () => {
    const columns = computeThreadsScoreColumns(scoreResponse({}));
    expect(summarizeFailingCriteria(columns)).toContain("さらに改善");
  });

  it("基準未達の軸ごとに具体的な指摘を含む", () => {
    const columns = computeThreadsScoreColumns(scoreResponse({ ai_smell: 90 }));
    const summary = summarizeFailingCriteria(columns);
    expect(summary).toContain("AI臭が強すぎます");
  });
});
