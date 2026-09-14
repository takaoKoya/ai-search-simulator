import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import { IDEA_SCORE_CRITERIA } from "@/lib/growth-os/types";
import { computeTotalScore, validateScoreBreakdown } from "@/lib/growth-os/scoring";
import type { IdeaScoreBreakdownEntry } from "@/lib/growth-os/types";

export interface IdeaScoreResult {
  score_breakdown: IdeaScoreBreakdownEntry[];
  total_score: number;
}

const CRITERIA_TEXT = IDEA_SCORE_CRITERIA.map((c) => `- ${c.key} (${c.label}, 満点${c.weight}点)`).join("\n");

const SYSTEM = `あなたは「50代note Growth OS」のIdea Scorer Agentです。
45〜59歳の会社員（「会社を辞めたいわけではないが、会社だけに依存しているのは怖い」層）向けのコンテンツ企画を、以下9軸・合計100点で採点します。

${CRITERIA_TEXT}

各軸ごとに0〜満点の整数スコアと、なぜその点数にしたかの具体的な理由(1〜2文)を日本語で返してください。
採点のブレを避けるため、印象論ではなく「読者の具体的な行動意欲・支払意欲・競合状況」を根拠にしてください。
出力は指定のJSONスキーマのみ。`;

export async function scoreIdea(input: { title: string; summary: string | null }): Promise<IdeaScoreResult> {
  const prompt = `以下のコンテンツ企画テーマを採点してください。

タイトル: ${input.title}
概要: ${input.summary ?? "(なし)"}

以下のJSONスキーマで出力してください(criterionは英語キーのまま):
{
  "score_breakdown": [
    { "criterion": "demand", "weight": 15, "score": number, "reasoning": string },
    { "criterion": "pain_depth", "weight": 15, "score": number, "reasoning": string },
    { "criterion": "willingness_to_pay", "weight": 15, "score": number, "reasoning": string },
    { "criterion": "competition_weakness", "weight": 10, "score": number, "reasoning": string },
    { "criterion": "trend", "weight": 10, "score": number, "reasoning": string },
    { "criterion": "threads_virality", "weight": 10, "score": number, "reasoning": string },
    { "criterion": "note_fit", "weight": 10, "score": number, "reasoning": string },
    { "criterion": "product_connection", "weight": 10, "score": number, "reasoning": string },
    { "criterion": "user_fit", "weight": 5, "score": number, "reasoning": string }
  ]
}`;

  const result = await callClaudeForJson<{ score_breakdown: IdeaScoreBreakdownEntry[] }>({
    system: SYSTEM,
    prompt,
    maxTokens: 2048,
  });

  const errors = validateScoreBreakdown(result.data.score_breakdown);
  if (errors.length > 0) {
    throw new Error(`Idea Scorerの出力が不正です: ${errors.join(" / ")}`);
  }

  return {
    score_breakdown: result.data.score_breakdown,
    total_score: computeTotalScore(result.data.score_breakdown),
  };
}
