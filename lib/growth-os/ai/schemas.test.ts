import { describe, it, expect } from "vitest";
import {
  threadsDraftSchema,
  threadsGenerationResponseSchema,
  outlineResponseSchema,
  factClaimDraftSchema,
  factCheckResponseSchema,
  paidCandidateEvaluationSchema,
  sectionDraftSchema,
} from "./schemas";

describe("threadsGenerationResponseSchema", () => {
  const validPost = (pattern: string) => ({
    pattern_type: pattern,
    body: "本文です。",
    experience_ids_used: [],
    needs_user_story: false,
  });

  it("5パターンすべて揃っていれば妥当", () => {
    const result = threadsGenerationResponseSchema.safeParse({
      posts: ["EMPATHY", "PROBLEM", "FAILURE", "QUESTION", "CONTRARIAN"].map(validPost),
    });
    expect(result.success).toBe(true);
  });

  it("4件しか無ければ不正(5パターン必須)", () => {
    const result = threadsGenerationResponseSchema.safeParse({
      posts: ["EMPATHY", "PROBLEM", "FAILURE", "QUESTION"].map(validPost),
    });
    expect(result.success).toBe(false);
  });

  it("未知のpattern_typeは不正", () => {
    const result = threadsDraftSchema.safeParse(validPost("UNKNOWN_PATTERN"));
    expect(result.success).toBe(false);
  });

  it("bodyが空文字なら不正", () => {
    const result = threadsDraftSchema.safeParse({ ...validPost("EMPATHY"), body: "" });
    expect(result.success).toBe(false);
  });
});

describe("outlineResponseSchema", () => {
  const titleCandidate = (type: string) => ({
    title: `タイトル(${type})`,
    type,
    click_score: 80,
    trust_score: 80,
    specificity_score: 80,
    sales_smell_score: 10,
  });

  const valid = {
    title_candidates: ["共感", "疑問", "告白", "問題提起", "ベネフィット"].map(titleCandidate),
    recommended_title_index: 0,
    lead: "リード文",
    reader_problem: "読者の悩み",
    promise: "この記事の約束",
    sections: [
      { heading: "見出し1", purpose: "目的1", key_points: ["点1"], evidence_required: false, experience_required: false },
      { heading: "見出し2", purpose: "目的2", key_points: ["点2"], evidence_required: true, experience_required: false },
      { heading: "見出し3", purpose: "目的3", key_points: ["点3"], evidence_required: false, experience_required: true },
    ],
    cta: { type: "FOLLOW", text: "フォローしてください" },
  };

  it("タイトル5案・3セクション以上あれば妥当", () => {
    expect(outlineResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("タイトル案が5件未満なら不正", () => {
    const result = outlineResponseSchema.safeParse({ ...valid, title_candidates: valid.title_candidates.slice(0, 4) });
    expect(result.success).toBe(false);
  });

  it("sectionsが2件以下(3件未満)なら不正", () => {
    const result = outlineResponseSchema.safeParse({ ...valid, sections: valid.sections.slice(0, 2) });
    expect(result.success).toBe(false);
  });

  it("recommended_title_indexが範囲外(0-4)なら不正", () => {
    const result = outlineResponseSchema.safeParse({ ...valid, recommended_title_index: 5 });
    expect(result.success).toBe(false);
  });
});

describe("sectionDraftSchema(no-fabricated-experience: schemaはexperience_ids_usedを必須構造として持つ)", () => {
  it("experience_ids_usedが空配列でも妥当(体験が登録されていない場合)", () => {
    const result = sectionDraftSchema.safeParse({
      content: "一般的なケースでは、というアプローチが有効です。",
      experience_ids_used: [],
      source_ids_used: [],
      needs_user_input: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("factCheckResponseSchema / factClaimDraftSchema", () => {
  it("分類・信頼度が範囲内なら妥当", () => {
    const result = factClaimDraftSchema.safeParse({
      claim: "50代の転職成功率は30%です",
      classification: "VERIFIED",
      source_hint_index: 0,
      confidence: 90,
    });
    expect(result.success).toBe(true);
  });

  it("未知の分類は不正", () => {
    const result = factClaimDraftSchema.safeParse({
      claim: "テスト",
      classification: "MAYBE",
      source_hint_index: null,
      confidence: 50,
    });
    expect(result.success).toBe(false);
  });

  it("claimsが空配列でも妥当(主張が無い記事もあり得る)", () => {
    expect(factCheckResponseSchema.safeParse({ claims: [] }).success).toBe(true);
  });
});

describe("paidCandidateEvaluationSchema", () => {
  it("6軸すべて0-100・reasoningありなら妥当", () => {
    const result = paidCandidateEvaluationSchema.safeParse({
      problem_depth: 80,
      actionability: 70,
      repeat_value: 60,
      specificity: 75,
      transformation_value: 65,
      purchase_intent: 55,
      is_paid_candidate: true,
      reasoning: "具体的な行動計画への需要が高いため",
    });
    expect(result.success).toBe(true);
  });

  it("reasoningが空文字なら不正(点数だけの判定を禁止)", () => {
    const result = paidCandidateEvaluationSchema.safeParse({
      problem_depth: 80,
      actionability: 70,
      repeat_value: 60,
      specificity: 75,
      transformation_value: 65,
      purchase_intent: 55,
      is_paid_candidate: true,
      reasoning: "",
    });
    expect(result.success).toBe(false);
  });

  it("スコアが範囲外(100超)なら不正", () => {
    const result = paidCandidateEvaluationSchema.safeParse({
      problem_depth: 150,
      actionability: 70,
      repeat_value: 60,
      specificity: 75,
      transformation_value: 65,
      purchase_intent: 55,
      is_paid_candidate: true,
      reasoning: "理由",
    });
    expect(result.success).toBe(false);
  });
});
