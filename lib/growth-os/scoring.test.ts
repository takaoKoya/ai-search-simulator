import { describe, it, expect } from "vitest";
import { computeTotalScore, ideaTier, validateScoreBreakdown } from "./scoring";
import type { IdeaScoreBreakdownEntry } from "./types";

const FULL_BREAKDOWN: IdeaScoreBreakdownEntry[] = [
  { criterion: "demand", weight: 15, score: 15, reasoning: "" },
  { criterion: "pain_depth", weight: 15, score: 14, reasoning: "" },
  { criterion: "willingness_to_pay", weight: 15, score: 12, reasoning: "" },
  { criterion: "competition_weakness", weight: 10, score: 8, reasoning: "" },
  { criterion: "trend", weight: 10, score: 9, reasoning: "" },
  { criterion: "threads_virality", weight: 10, score: 9, reasoning: "" },
  { criterion: "note_fit", weight: 10, score: 8, reasoning: "" },
  { criterion: "product_connection", weight: 10, score: 7, reasoning: "" },
  { criterion: "user_fit", weight: 5, score: 5, reasoning: "" },
];

describe("computeTotalScore", () => {
  it("全軸満点なら100になる", () => {
    const full = FULL_BREAKDOWN.map((e) => ({ ...e, score: e.weight }));
    expect(computeTotalScore(full)).toBe(100);
  });

  it("各軸の合計をそのまま返す", () => {
    // 15+14+12+8+9+9+8+7+5 = 87
    expect(computeTotalScore(FULL_BREAKDOWN)).toBe(87);
  });

  it("重みを超えるscoreはクランプされる(AI出力の暴走対策)", () => {
    const overshoot: IdeaScoreBreakdownEntry[] = [
      { criterion: "demand", weight: 15, score: 999, reasoning: "" },
    ];
    expect(computeTotalScore(overshoot)).toBe(15);
  });

  it("負のscoreは0にクランプされる", () => {
    const negative: IdeaScoreBreakdownEntry[] = [
      { criterion: "demand", weight: 15, score: -5, reasoning: "" },
    ];
    expect(computeTotalScore(negative)).toBe(0);
  });
});

describe("ideaTier", () => {
  it("90点以上はTOP", () => {
    expect(ideaTier(90)).toBe("TOP");
    expect(ideaTier(100)).toBe("TOP");
  });

  it("85〜89点はCANDIDATE", () => {
    expect(ideaTier(85)).toBe("CANDIDATE");
    expect(ideaTier(89)).toBe("CANDIDATE");
  });

  it("75〜84点はHOLD", () => {
    expect(ideaTier(75)).toBe("HOLD");
    expect(ideaTier(84)).toBe("HOLD");
  });

  it("74点以下はREJECT", () => {
    expect(ideaTier(74)).toBe("REJECT");
    expect(ideaTier(0)).toBe("REJECT");
  });
});

describe("validateScoreBreakdown", () => {
  it("9軸すべて揃っていればエラーなし", () => {
    expect(validateScoreBreakdown(FULL_BREAKDOWN)).toEqual([]);
  });

  it("欠落した軸を検出する", () => {
    const missing = FULL_BREAKDOWN.slice(0, -1);
    const errors = validateScoreBreakdown(missing);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ユーザーとの相性");
  });

  it("重みを超えるscoreを検出する", () => {
    const invalid = FULL_BREAKDOWN.map((e) => (e.criterion === "demand" ? { ...e, score: 20 } : e));
    const errors = validateScoreBreakdown(invalid);
    expect(errors.some((e) => e.includes("需要"))).toBe(true);
  });
});
