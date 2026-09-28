// Threads 9軸品質評価(セクション4)の集計ロジック。
// overall_scoreはAIに自己申告させず、9軸の個別スコアからアプリ側で機械的に算出する
// (「AIの自己申告だけで確定させない」という一貫方針をThreadsの品質判定にも適用する)。

import type { ThreadsScoreResponse } from "@/lib/growth-os/ai/schemas";
import type { ThreadsScoreReasonEntry } from "@/lib/growth-os/types";

const POSITIVE_CRITERIA = ["hook", "empathy", "humanity", "clarity", "shareability"] as const;
const NEGATIVE_CRITERIA = ["sales_smell", "ai_smell", "preachiness", "fear"] as const;

function average(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

export interface ThreadsScoreColumns {
  hook_score: number;
  empathy_score: number;
  humanity_score: number;
  clarity_score: number;
  shareability_score: number;
  sales_smell_score: number;
  ai_smell_score: number;
  preachiness_score: number;
  fear_score: number;
  overall_score: number;
  score_reason: ThreadsScoreReasonEntry[];
}

type ThreadsScoreCriterion = ThreadsScoreResponse["scores"][number]["criterion"];

/** overall = (良い軸の平均) - (悪い軸の平均) × 0.5 を 0〜100 にクランプする。 */
export function computeThreadsScoreColumns(response: ThreadsScoreResponse): ThreadsScoreColumns {
  const byCriterion = new Map(response.scores.map((s) => [s.criterion, s]));
  const get = (key: ThreadsScoreCriterion) => byCriterion.get(key)?.score ?? 0;

  const positiveAvg = average(POSITIVE_CRITERIA.map(get));
  const negativeAvg = average(NEGATIVE_CRITERIA.map(get));
  const overall = Math.round(Math.min(Math.max(positiveAvg - negativeAvg * 0.5, 0), 100));

  return {
    hook_score: get("hook"),
    empathy_score: get("empathy"),
    humanity_score: get("humanity"),
    clarity_score: get("clarity"),
    shareability_score: get("shareability"),
    sales_smell_score: get("sales_smell"),
    ai_smell_score: get("ai_smell"),
    preachiness_score: get("preachiness"),
    fear_score: get("fear"),
    overall_score: overall,
    score_reason: response.scores,
  };
}

/** リライト時にAIへ渡す、不合格だった軸だけをまとめたフィードバック文。 */
export function summarizeFailingCriteria(columns: ThreadsScoreColumns): string {
  const reasonByCriterion = new Map(columns.score_reason.map((r) => [r.criterion, r.reason]));
  const notes: string[] = [];

  if (columns.overall_score < 80) notes.push(`総合スコアが基準(80点)未満です(${columns.overall_score}点)`);
  if (columns.ai_smell_score > 30) notes.push(`AI臭が強すぎます(${columns.ai_smell_score}点): ${reasonByCriterion.get("ai_smell") ?? ""}`);
  if (columns.sales_smell_score > 40) notes.push(`売り込み臭が強すぎます(${columns.sales_smell_score}点): ${reasonByCriterion.get("sales_smell") ?? ""}`);
  if (columns.fear_score > 50) notes.push(`不安を煽りすぎています(${columns.fear_score}点): ${reasonByCriterion.get("fear") ?? ""}`);

  return notes.length > 0 ? notes.join("\n") : "品質基準は満たしていますが、さらに改善してください。";
}
