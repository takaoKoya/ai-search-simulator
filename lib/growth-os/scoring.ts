import {
  IDEA_SCORE_CRITERIA,
  type IdeaScoreReasonEntry,
  type IdeaStatus,
  type ScoreBandCode,
} from "@/lib/growth-os/types";

export interface ScoreBand {
  code: ScoreBandCode;
  label: string;
}

/**
 * total_score の帯によるUI表示用ラベル。DBの`status`(ワークフロー状態)とは独立していて、
 * カード上には常にこのテキストラベルを添える(色だけで判断させない、という要件のため)。
 */
export function scoreBand(totalScore: number): ScoreBand {
  if (totalScore >= 90) return { code: "TOP", label: "最優先候補" };
  if (totalScore >= 85) return { code: "CANDIDATE", label: "制作候補" };
  if (totalScore >= 75) return { code: "HOLD", label: "保留候補" };
  return { code: "LOW", label: "低優先" };
}

/**
 * スコアリング直後にstatusをNEWからどこへ自動遷移させるかの既定ルール。
 * 90点以上はPRIORITY、85〜89点はCANDIDATE、それ未満はHOLDへ寄せる
 * (74点以下の「低優先」に対応する専用ステータスは設けず、HOLDに含める)。
 * 人間の最終判断(APPROVE/REJECT)はこの自動分類を上書きする。
 */
export function defaultStatusForScore(totalScore: number): IdeaStatus {
  const band = scoreBand(totalScore);
  if (band.code === "TOP") return "PRIORITY";
  if (band.code === "CANDIDATE") return "CANDIDATE";
  return "HOLD";
}

/** 各軸のscoreを0〜weightにクランプした上で合計する(0〜100)。DB保存前のプレビュー/検証用。 */
export function computeTotalScore(entries: IdeaScoreReasonEntry[]): number {
  const total = entries.reduce((sum, entry) => {
    const weight = IDEA_SCORE_CRITERIA.find((c) => c.key === entry.criterion)?.weight ?? 0;
    const clamped = Math.min(Math.max(entry.score, 0), weight);
    return sum + clamped;
  }, 0);
  return Math.round(Math.min(Math.max(total, 0), 100) * 10) / 10;
}

/** AIの出力に欠落した軸がないか、重みを超過していないか、reason/evidenceが空でないかを検証する。 */
export function validateScoreReason(entries: IdeaScoreReasonEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set(entries.map((e) => e.criterion));

  for (const criterion of IDEA_SCORE_CRITERIA) {
    if (!seen.has(criterion.key)) {
      errors.push(`${criterion.label}(${criterion.key})の評価が欠落しています`);
    }
  }

  for (const entry of entries) {
    const criterion = IDEA_SCORE_CRITERIA.find((c) => c.key === entry.criterion);
    if (!criterion) {
      errors.push(`未知の評価軸です: ${entry.criterion}`);
      continue;
    }
    if (entry.score < 0 || entry.score > criterion.weight) {
      errors.push(`${criterion.label}のスコアが範囲外です(0〜${criterion.weight}): ${entry.score}`);
    }
    if (!entry.reason?.trim()) {
      errors.push(`${criterion.label}のreasonが空です(点数だけの評価は禁止)`);
    }
    if (!entry.evidence?.trim()) {
      errors.push(`${criterion.label}のevidenceが空です`);
    }
  }

  return errors;
}

/** content_ideasの実カラムを更新用オブジェクトへ変換する(score_reasonのcriterion→列名マッピング)。 */
export function scoreReasonToColumns(entries: IdeaScoreReasonEntry[]): Record<string, number> {
  const columns: Record<string, number> = {};
  for (const entry of entries) {
    const criterion = IDEA_SCORE_CRITERIA.find((c) => c.key === entry.criterion);
    if (!criterion) continue;
    columns[criterion.column] = Math.min(Math.max(entry.score, 0), criterion.weight);
  }
  return columns;
}
