// AIの自己申告スコアを鵜呑みにしないための、根拠の強さ(Confidence)算出ロジック。
// Score(総合点)とConfidence(信頼度)の2軸で判断する(セクション4)。

const HIGH_SCORE_THRESHOLD = 85;
const HIGH_CONFIDENCE_THRESHOLD = 60;

export interface ConfidenceInput {
  /** このIdeaの根拠となったResearch件数(gos_idea_sourcesの行数) */
  evidenceCount: number;
  /** 出典の多様性。distinctなsource_name(またはsource_type)の件数 */
  sourceCount: number;
  /** 0-100。Research収集日の新しさから算出(computeFreshnessScore参照) */
  freshnessScore: number;
  /** 0-100。AIが自己申告した採点への自信(単体では信用しない) */
  aiSelfAssessedConfidence: number;
}

/**
 * Confidence = 客観的な根拠件数・多様性・鮮度 を主軸に、AIの自己申告を補助的に加味して算出する。
 * AIの自己申告だけで決めると「AIが自信満々に言っただけ」を信頼度が高いと誤認するため、
 * 重みは客観指標(evidence+source+freshness=80%)を主、AI自己申告(20%)を従とする。
 */
export function computeConfidence(input: ConfidenceInput): number {
  const evidenceComponent = Math.min(input.evidenceCount / 3, 1) * 100; // 3件以上の根拠で頭打ち
  const sourceComponent = Math.min(input.sourceCount / 2, 1) * 100; // 2種類以上の出典で頭打ち
  const freshnessComponent = Math.min(Math.max(input.freshnessScore, 0), 100);
  const aiComponent = Math.min(Math.max(input.aiSelfAssessedConfidence, 0), 100);

  const weighted =
    evidenceComponent * 0.3 + sourceComponent * 0.25 + freshnessComponent * 0.25 + aiComponent * 0.2;

  return Math.round(Math.min(Math.max(weighted, 0), 100));
}

/**
 * Research収集日(複数可)の新しさから鮮度スコア(0-100)を算出する。
 * 直近のもの1件でも新しければ高スコアになるよう、最も新しい日付を採用する。
 */
export function computeFreshnessScore(collectedAtDates: Date[], now: Date = new Date()): number {
  if (collectedAtDates.length === 0) return 0;

  const ageDaysList = collectedAtDates.map((d) => (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  const mostRecentAgeDays = Math.max(0, Math.min(...ageDaysList));
  const decay = Math.exp(-mostRecentAgeDays / 90);

  return Math.round(Math.max(20, decay * 100));
}

export type ConfidenceJudgment =
  | "STRONG_CANDIDATE" // 有力候補
  | "HIGH_SCORE_LOW_EVIDENCE" // 高得点だが根拠不足
  | "SOLID_BUT_LOW_PRIORITY" // 根拠は強いが優先度は中程度
  | "INSUFFICIENT_DATA"; // 判断材料不足

export const CONFIDENCE_JUDGMENT_LABELS: Record<ConfidenceJudgment, string> = {
  STRONG_CANDIDATE: "有力候補",
  HIGH_SCORE_LOW_EVIDENCE: "高得点だが根拠不足",
  SOLID_BUT_LOW_PRIORITY: "根拠は強いが優先度は中程度",
  INSUFFICIENT_DATA: "判断材料不足",
};

/** Score × Confidence の2軸から、一言の判断ラベルを導出する。 */
export function judgeIdea(totalScore: number, confidenceScore: number): ConfidenceJudgment {
  const highScore = totalScore >= HIGH_SCORE_THRESHOLD;
  const highConfidence = confidenceScore >= HIGH_CONFIDENCE_THRESHOLD;

  if (highScore && highConfidence) return "STRONG_CANDIDATE";
  if (highScore && !highConfidence) return "HIGH_SCORE_LOW_EVIDENCE";
  if (!highScore && highConfidence) return "SOLID_BUT_LOW_PRIORITY";
  return "INSUFFICIENT_DATA";
}
