import { IDEA_SCORE_CRITERIA, type IdeaScoreBreakdownEntry, type IdeaTier } from "@/lib/growth-os/types";

/** DB側の生成列(tier)と同じ判定基準。DB往復前の楽観的UI表示に使う。 */
export function ideaTier(totalScore: number): IdeaTier {
  if (totalScore >= 90) return "TOP";
  if (totalScore >= 85) return "CANDIDATE";
  if (totalScore >= 75) return "HOLD";
  return "REJECT";
}

export const IDEA_TIER_LABELS: Record<IdeaTier, string> = {
  TOP: "最優先",
  CANDIDATE: "制作候補",
  HOLD: "保留",
  REJECT: "原則不採用",
};

/** 各軸のscoreを0〜weightにクランプした上で合計する(0〜100)。 */
export function computeTotalScore(breakdown: IdeaScoreBreakdownEntry[]): number {
  const total = breakdown.reduce((sum, entry) => {
    const weight = IDEA_SCORE_CRITERIA.find((c) => c.key === entry.criterion)?.weight ?? entry.weight;
    const clamped = Math.min(Math.max(entry.score, 0), weight);
    return sum + clamped;
  }, 0);
  return Math.round(Math.min(Math.max(total, 0), 100) * 10) / 10;
}

/** AIの出力に欠落した軸がないか、重みを超過していないかを検証する。 */
export function validateScoreBreakdown(breakdown: IdeaScoreBreakdownEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set(breakdown.map((e) => e.criterion));

  for (const criterion of IDEA_SCORE_CRITERIA) {
    if (!seen.has(criterion.key)) {
      errors.push(`${criterion.label}(${criterion.key})の評価が欠落しています`);
    }
  }

  for (const entry of breakdown) {
    const criterion = IDEA_SCORE_CRITERIA.find((c) => c.key === entry.criterion);
    if (!criterion) {
      errors.push(`未知の評価軸です: ${entry.criterion}`);
      continue;
    }
    if (entry.score < 0 || entry.score > criterion.weight) {
      errors.push(`${criterion.label}のスコアが範囲外です(0〜${criterion.weight}): ${entry.score}`);
    }
  }

  return errors;
}
