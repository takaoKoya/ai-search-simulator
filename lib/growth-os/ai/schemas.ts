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
