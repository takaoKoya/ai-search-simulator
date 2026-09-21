import { describe, it, expect } from "vitest";
import {
  computeTotalScore,
  scoreBand,
  defaultStatusForScore,
  validateScoreReason,
  scoreReasonToColumns,
} from "./scoring";
import type { IdeaScoreReasonEntry } from "./types";

const FULL_ENTRIES: IdeaScoreReasonEntry[] = [
  { criterion: "demand", score: 15, reason: "強い需要がある", evidence: "Research#1のPVが高い" },
  { criterion: "pain", score: 14, reason: "悩みが深い", evidence: "コメント欄の反応" },
  { criterion: "willingness_to_pay", score: 12, reason: "支払意欲がある", evidence: "有料級の情報要求" },
  { criterion: "competition_opportunity", score: 8, reason: "競合が弱い", evidence: "検索結果が薄い" },
  { criterion: "trend", score: 9, reason: "トレンドに乗っている", evidence: "検索数増加" },
  { criterion: "threads_virality", score: 9, reason: "拡散されやすい", evidence: "共感型で書ける" },
  { criterion: "note_fit", score: 8, reason: "note向き", evidence: "長文で深掘りできる" },
  { criterion: "product_connection", score: 7, reason: "商品接続性あり", evidence: "診断コンテンツ化できる" },
  { criterion: "user_fit", score: 5, reason: "ユーザー適性が高い", evidence: "ブランド思想と一致" },
];

describe("computeTotalScore", () => {
  it("全軸満点なら100になる", () => {
    const full = FULL_ENTRIES.map((e) => {
      const weight = { demand: 15, pain: 15, willingness_to_pay: 15, competition_opportunity: 10, trend: 10, threads_virality: 10, note_fit: 10, product_connection: 10, user_fit: 5 }[e.criterion];
      return { ...e, score: weight };
    });
    expect(computeTotalScore(full)).toBe(100);
  });

  it("各軸の合計をそのまま返す", () => {
    // 15+14+12+8+9+9+8+7+5 = 87
    expect(computeTotalScore(FULL_ENTRIES)).toBe(87);
  });

  it("重みを超えるscoreはクランプされる(AI出力の暴走対策)", () => {
    expect(computeTotalScore([{ criterion: "demand", score: 999, reason: "x", evidence: "y" }])).toBe(15);
  });

  it("負のscoreは0にクランプされる", () => {
    expect(computeTotalScore([{ criterion: "demand", score: -5, reason: "x", evidence: "y" }])).toBe(0);
  });
});

describe("scoreBand", () => {
  it("90点以上はTOP(最優先候補)", () => {
    expect(scoreBand(90).code).toBe("TOP");
    expect(scoreBand(100).label).toBe("最優先候補");
  });

  it("85〜89点はCANDIDATE(制作候補)", () => {
    expect(scoreBand(85).code).toBe("CANDIDATE");
    expect(scoreBand(89).label).toBe("制作候補");
  });

  it("75〜84点はHOLD(保留候補)", () => {
    expect(scoreBand(75).code).toBe("HOLD");
    expect(scoreBand(84).label).toBe("保留候補");
  });

  it("74点以下はLOW(低優先)", () => {
    expect(scoreBand(74).code).toBe("LOW");
    expect(scoreBand(0).label).toBe("低優先");
  });
});

describe("defaultStatusForScore", () => {
  it("90点以上はPRIORITY", () => {
    expect(defaultStatusForScore(92)).toBe("PRIORITY");
  });
  it("85〜89点はCANDIDATE", () => {
    expect(defaultStatusForScore(87)).toBe("CANDIDATE");
  });
  it("84点以下はHOLD(低優先も含む)", () => {
    expect(defaultStatusForScore(80)).toBe("HOLD");
    expect(defaultStatusForScore(40)).toBe("HOLD");
  });
});

describe("validateScoreReason", () => {
  it("9軸すべて揃っていればエラーなし", () => {
    expect(validateScoreReason(FULL_ENTRIES)).toEqual([]);
  });

  it("欠落した軸を検出する", () => {
    const errors = validateScoreReason(FULL_ENTRIES.slice(0, -1));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ユーザー適性");
  });

  it("重みを超えるscoreを検出する", () => {
    const invalid = FULL_ENTRIES.map((e) => (e.criterion === "demand" ? { ...e, score: 20 } : e));
    expect(validateScoreReason(invalid).some((e) => e.includes("需要"))).toBe(true);
  });

  it("reasonが空の場合を検出する(点数だけの評価を禁止)", () => {
    const invalid = FULL_ENTRIES.map((e) => (e.criterion === "demand" ? { ...e, reason: "" } : e));
    expect(validateScoreReason(invalid).some((e) => e.includes("reasonが空"))).toBe(true);
  });

  it("evidenceが空の場合を検出する", () => {
    const invalid = FULL_ENTRIES.map((e) => (e.criterion === "demand" ? { ...e, evidence: "" } : e));
    expect(validateScoreReason(invalid).some((e) => e.includes("evidenceが空"))).toBe(true);
  });
});

describe("scoreReasonToColumns", () => {
  it("criterionキーをDBカラム名にマッピングする", () => {
    const columns = scoreReasonToColumns(FULL_ENTRIES);
    expect(columns.demand_score).toBe(15);
    expect(columns.pain_score).toBe(14);
    expect(columns.willingness_to_pay_score).toBe(12);
    expect(columns.user_fit_score).toBe(5);
  });
});
