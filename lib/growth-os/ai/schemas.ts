import { z } from "zod";
import { HARM_TYPES, IDEA_SCORE_CRITERIA, type HarmType, type IdeaScoreCriterionKey } from "@/lib/growth-os/types";

const harmTypeSchema = z.enum(HARM_TYPES as [HarmType, ...HarmType[]]);
const criterionKeySchema = z.enum(
  IDEA_SCORE_CRITERIA.map((c) => c.key) as [IdeaScoreCriterionKey, ...IdeaScoreCriterionKey[]]
);

// ------------------------------------------------------------------
// analyzeResearch: HARM分類 + 表面/深層の悩み + 感情トリガー抽出
// ------------------------------------------------------------------
export const researchAnalysisSchema = z.object({
  harm_types: z.array(harmTypeSchema).min(1).max(4),
  surface_problem: z.string().min(1),
  deep_problem: z.string().min(1),
  emotional_trigger: z.string().min(1),
  trend_score: z.number().min(0).max(100),
  pain_score: z.number().min(0).max(100),
  reasoning: z.string().min(1),
});
export type ResearchAnalysis = z.infer<typeof researchAnalysisSchema>;

// ------------------------------------------------------------------
// generateIdeas: Research(複数可)からコンテンツテーマ候補を生成
// ------------------------------------------------------------------
export const generatedIdeaSchema = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  angle: z.string().min(1),
  target_persona: z.string().min(1),
  core_problem: z.string().min(1),
  harm_types: z.array(harmTypeSchema).min(1).max(4),
  recommended_format: z.enum(["THREADS", "NOTE_FREE", "NOTE_PAID", "BOTH"]),
  recommended_free_or_paid: z.enum(["FREE", "PAID", "EITHER"]),
});
export type GeneratedIdea = z.infer<typeof generatedIdeaSchema>;

export const ideaGenerationResponseSchema = z.object({
  ideas: z.array(generatedIdeaSchema).min(1).max(5),
});

// ------------------------------------------------------------------
// scoreIdea: 9軸スコアリング。各軸に score/reason/evidence を必須で持たせ、
// 「92点」とだけ言わせることを禁止する。AIの自己申告confidenceは、
// アプリ側confidence計算の入力の1つに過ぎず、それ単体では確定値としない。
// ------------------------------------------------------------------
export const ideaScoreEntrySchema = z.object({
  criterion: criterionKeySchema,
  score: z.number().min(0),
  reason: z.string().min(1),
  evidence: z.string().min(1),
});

export const ideaScoreResponseSchema = z.object({
  scores: z.array(ideaScoreEntrySchema).length(IDEA_SCORE_CRITERIA.length),
  confidence_self_assessment: z.number().min(0).max(100),
});
export type IdeaScoreResponse = z.infer<typeof ideaScoreResponseSchema>;

// ====================================================================
// フェーズ3: Content Strategy → Threads → Outline → Draft → Review → FactCheck
// ====================================================================

// --------------------------------------------------------------
// Content Strategy(セクション2): 「何を書くか」の前に「読者をどう動かすか」を定義する
// --------------------------------------------------------------
export const contentStrategySchema = z.object({
  target_reader: z.string().min(1),
  reader_situation: z.string().min(1),
  surface_problem: z.string().min(1),
  deep_problem: z.string().min(1),
  desired_emotion: z.string().min(1),
  desired_action: z.string().min(1),
  main_message: z.string().min(1),
  unique_angle: z.string().min(1),
  content_goal: z.string().min(1),
  free_or_paid: z.enum(["FREE", "PAID", "BOTH"]),
  cta_strategy: z.string().min(1),
  threads_role: z.string().min(1),
  free_note_role: z.string().min(1),
  paid_note_role: z.string().nullable(),
});
export type ContentStrategyDraft = z.infer<typeof contentStrategySchema>;

// --------------------------------------------------------------
// Threads Content Engine(セクション3・4): 生成 + 品質評価
// 「体験・ストーリー型」は Experience Library に無い体験を捏造してはならないため、
// experience_ids_used(提供したID以外は使用禁止)と needs_user_story
// (本人の体験入力が必要な空欄にした場合はtrue)を必須で持たせる。
// --------------------------------------------------------------
const threadsPatternTypeSchema = z.enum(["EMPATHY", "PROBLEM", "FAILURE", "QUESTION", "CONTRARIAN"]);

export const threadsDraftSchema = z.object({
  pattern_type: threadsPatternTypeSchema,
  body: z.string().min(1),
  experience_ids_used: z.array(z.string()),
  needs_user_story: z.boolean(),
});
export type ThreadsDraft = z.infer<typeof threadsDraftSchema>;

export const threadsGenerationResponseSchema = z.object({
  posts: z.array(threadsDraftSchema).length(5),
});

const threadsScoreCriterionSchema = z.enum([
  "hook",
  "empathy",
  "humanity",
  "clarity",
  "shareability",
  "sales_smell",
  "ai_smell",
  "preachiness",
  "fear",
]);

export const threadsScoreEntrySchema = z.object({
  criterion: threadsScoreCriterionSchema,
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
});

export const threadsScoreResponseSchema = z.object({
  scores: z.array(threadsScoreEntrySchema).length(9),
});
export type ThreadsScoreResponse = z.infer<typeof threadsScoreResponseSchema>;

// --------------------------------------------------------------
// Outline(セクション7・8): 本文生成前に必ずタイトル案・構成を人間が確認する
// --------------------------------------------------------------
const titleTypeSchema = z.enum(["共感", "疑問", "告白", "問題提起", "ベネフィット"]);

export const titleCandidateSchema = z.object({
  title: z.string().min(1),
  type: titleTypeSchema,
  click_score: z.number().min(0).max(100),
  trust_score: z.number().min(0).max(100),
  specificity_score: z.number().min(0).max(100),
  sales_smell_score: z.number().min(0).max(100),
});

export const outlineSectionSchema = z.object({
  heading: z.string().min(1),
  purpose: z.string().min(1),
  key_points: z.array(z.string().min(1)).min(1).max(6),
  evidence_required: z.boolean(),
  experience_required: z.boolean(),
});

export const ctaSchema = z.object({
  type: z.enum(["FOLLOW", "NEXT_ARTICLE", "FREE_DIAGNOSIS", "PAID_NOTE", "PRODUCT", "COMMENT"]),
  text: z.string().min(1),
});

export const outlineResponseSchema = z.object({
  title_candidates: z.array(titleCandidateSchema).length(5),
  recommended_title_index: z.number().int().min(0).max(4),
  lead: z.string().min(1),
  reader_problem: z.string().min(1),
  promise: z.string().min(1),
  sections: z.array(outlineSectionSchema).min(3).max(8),
  cta: ctaSchema,
});
export type OutlineResponse = z.infer<typeof outlineResponseSchema>;

// --------------------------------------------------------------
// Section Draft(セクション9): 本文はSection単位で生成する
// --------------------------------------------------------------
export const sectionDraftSchema = z.object({
  content: z.string().min(1),
  experience_ids_used: z.array(z.string()),
  source_ids_used: z.array(z.string()),
  needs_user_input: z.boolean(),
});
export type SectionDraft = z.infer<typeof sectionDraftSchema>;

// --------------------------------------------------------------
// Article Review(セクション14・15): Strategy整合/読者反応/批評的編集 + 10軸スコア + 人間味
// --------------------------------------------------------------
const verdictSchema = z.enum(["PASS", "NEEDS_REVISION", "FAIL"]);

const reviewScoreCriterionSchema = z.enum([
  "hook",
  "empathy",
  "clarity",
  "humanity",
  "originality",
  "usefulness",
  "credibility",
  "structure",
  "cta",
  "commercial_potential",
]);

export const reviewScoreEntrySchema = z.object({
  criterion: reviewScoreCriterionSchema,
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
});

export const articleReviewResponseSchema = z.object({
  strategy_alignment: z.object({ verdict: verdictSchema, feedback: z.string().min(1) }),
  reader_reaction: z.object({ verdict: verdictSchema, feedback: z.string().min(1) }),
  critical_editor: z.object({
    verdict: verdictSchema,
    feedback: z.string().min(1),
    ai_smell_notes: z.array(z.string()),
    revision_instructions: z.string().min(1),
  }),
  humanity_assessment: z.object({
    score: z.number().min(0).max(100),
    reason: z.string().min(1),
    uses_experience: z.boolean(),
  }),
  scores: z.array(reviewScoreEntrySchema).length(10),
});
export type ArticleReviewResponse = z.infer<typeof articleReviewResponseSchema>;

// --------------------------------------------------------------
// Fact Check(セクション13): claim単位で抽出・分類する
// 数字・日付・制度・調査結果はsource_hint必須。AI自身の「正しい」宣言だけでは
// VERIFIED/SUPPORTEDにできないため、アプリ側(factCheck.ts)で強制降格する。
// --------------------------------------------------------------
const factClaimClassificationSchema = z.enum(["VERIFIED", "SUPPORTED", "UNVERIFIED", "OPINION", "EXPERIENCE"]);

export const factClaimDraftSchema = z.object({
  claim: z.string().min(1),
  classification: factClaimClassificationSchema,
  source_hint_index: z.number().int().min(0).nullable(),
  confidence: z.number().min(0).max(100),
});

export const factCheckResponseSchema = z.object({
  claims: z.array(factClaimDraftSchema),
});
export type FactCheckResponse = z.infer<typeof factCheckResponseSchema>;

// --------------------------------------------------------------
// Sales Edit(CTA・有料導線・売り込み臭)
// --------------------------------------------------------------
export const salesEditResponseSchema = z.object({
  cta_score: z.number().min(0).max(100),
  sales_smell_score: z.number().min(0).max(100),
  feedback: z.string().min(1),
  suggested_cta: ctaSchema.nullable(),
});
export type SalesEditResponse = z.infer<typeof salesEditResponseSchema>;

// --------------------------------------------------------------
// 有料note候補判定(セクション24)
// --------------------------------------------------------------
export const paidCandidateEvaluationSchema = z.object({
  problem_depth: z.number().min(0).max(100),
  actionability: z.number().min(0).max(100),
  repeat_value: z.number().min(0).max(100),
  specificity: z.number().min(0).max(100),
  transformation_value: z.number().min(0).max(100),
  purchase_intent: z.number().min(0).max(100),
  is_paid_candidate: z.boolean(),
  reasoning: z.string().min(1),
});
export type PaidCandidateEvaluationDraft = z.infer<typeof paidCandidateEvaluationSchema>;
