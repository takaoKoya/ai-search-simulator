import type { HarmType, IdeaStatus } from "@/lib/growth-os/types";

// Daily Recommendation Service(セクション14)。
// ランキング(スコア順)だけで決めず、Confidence・Freshness・直近テーマの偏りを考慮する。
// 将来「実績データ(公開後の反応)」を加味したい場合は、RecommendationCandidateに
// フィールドを追加し、below の重み付けを調整するだけで拡張できる設計にしてある。

export interface RecommendationCandidate {
  id: string;
  title: string;
  totalScore: number;
  confidenceScore: number | null;
  freshnessScore: number | null;
  harmTypes: HarmType[];
  status: IdeaStatus;
}

export interface DailyRecommendation {
  ideaId: string;
  title: string;
  rankScore: number;
  reason: string;
}

const ACTIONABLE_STATUSES: IdeaStatus[] = ["NEW", "PRIORITY", "CANDIDATE", "HOLD"];

// 直近の採用実績のうち、あるHARM区分の比率がこれを超えたら「偏っている」とみなす。
const OVERREPRESENTED_SHARE_THRESHOLD = 0.4;
const DIVERSITY_PENALTY_MULTIPLIER = 0.85;

function computeHarmTypeShare(history: RecommendationCandidate[]): Map<HarmType, number> {
  const counts = new Map<HarmType, number>();
  let total = 0;
  for (const item of history) {
    for (const harm of item.harmTypes) {
      counts.set(harm, (counts.get(harm) ?? 0) + 1);
      total += 1;
    }
  }
  const shares = new Map<HarmType, number>();
  if (total === 0) return shares;
  for (const [harm, count] of counts) {
    shares.set(harm, count / total);
  }
  return shares;
}

function baseScore(candidate: RecommendationCandidate): number {
  const confidence = candidate.confidenceScore ?? 50;
  const freshness = candidate.freshnessScore ?? 50;
  return candidate.totalScore * 0.5 + confidence * 0.3 + freshness * 0.2;
}

/**
 * 直近承認履歴(recentlyApproved)のHARM分布から偏りを検出し、
 * 偏っているHARM区分だけで構成される候補はスコアを減点する。
 * 少なくとも1つ、偏っていないHARM区分を含む候補はそのまま評価する。
 */
export function recommendDailyIdeas(
  candidates: RecommendationCandidate[],
  recentlyApproved: RecommendationCandidate[],
  limit = 3
): DailyRecommendation[] {
  const actionable = candidates.filter((c) => ACTIONABLE_STATUSES.includes(c.status));
  const harmShare = computeHarmTypeShare(recentlyApproved);
  const overrepresented = new Set(
    Array.from(harmShare.entries())
      .filter(([, share]) => share > OVERREPRESENTED_SHARE_THRESHOLD)
      .map(([harm]) => harm)
  );

  const scored = actionable.map((candidate) => {
    const isEntirelyOverrepresented =
      candidate.harmTypes.length > 0 && candidate.harmTypes.every((h) => overrepresented.has(h));

    const score = isEntirelyOverrepresented ? baseScore(candidate) * DIVERSITY_PENALTY_MULTIPLIER : baseScore(candidate);

    const reasonParts = [`スコア${candidate.totalScore}点`, `信頼度${Math.round(candidate.confidenceScore ?? 0)}%`];
    if (isEntirelyOverrepresented) {
      reasonParts.push("直近は同系統のテーマが続いているため、優先度をやや下げて評価");
    }

    return { ideaId: candidate.id, title: candidate.title, rankScore: Math.round(score * 10) / 10, reason: reasonParts.join("・") };
  });

  return scored.sort((a, b) => b.rankScore - a.rankScore).slice(0, limit);
}
