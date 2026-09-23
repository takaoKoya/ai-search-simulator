import { Badge } from "@/components/ui/badge";
import { scoreBand } from "@/lib/growth-os/scoring";
import type { IdeaStatus } from "@/lib/growth-os/types";

const SUCCESS_STATUSES = new Set(["APPROVED", "PUBLISHED", "DONE", "SUCCEEDED", "READY", "LAUNCHED", "PASS"]);
const WARNING_STATUSES = new Set(["WAITING_APPROVAL", "HOLD", "PENDING", "NEEDS_REVISION", "RUNNING", "REVIEWED"]);
const CRITICAL_STATUSES = new Set(["REJECTED", "FAILED", "FAIL", "ARCHIVED"]);

/** Threads/note/Products/AI Jobなど、汎用の状態文字列向け。 */
export function StatusBadge({ status }: { status: string }) {
  const variant = SUCCESS_STATUSES.has(status) ? "success" : WARNING_STATUSES.has(status) ? "warning" : CRITICAL_STATUSES.has(status) ? "critical" : "neutral";

  return <Badge variant={variant}>{status}</Badge>;
}

const IDEA_STATUS_VARIANT: Record<IdeaStatus, "neutral" | "accent" | "info" | "warning" | "success" | "critical"> = {
  NEW: "neutral",
  PRIORITY: "accent",
  CANDIDATE: "info",
  HOLD: "warning",
  APPROVED: "success",
  REJECTED: "critical",
};

const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  NEW: "NEW 未評価",
  PRIORITY: "PRIORITY",
  CANDIDATE: "CANDIDATE",
  HOLD: "HOLD 保留",
  APPROVED: "APPROVED 承認済み",
  REJECTED: "REJECTED 却下",
};

/** Idea専用のワークフロー状態バッジ(NEW/PRIORITY/CANDIDATE/HOLD/APPROVED/REJECTED)。 */
export function IdeaStatusBadge({ status }: { status: IdeaStatus }) {
  return <Badge variant={IDEA_STATUS_VARIANT[status]}>{IDEA_STATUS_LABEL[status]}</Badge>;
}

const SCORE_BAND_VARIANT = { TOP: "success", CANDIDATE: "accent", HOLD: "warning", LOW: "critical" } as const;

/** total_scoreの帯によるラベル(90+/85-89/75-84/74-)。DBのstatusとは独立した表示専用。 */
export function ScoreBandBadge({ totalScore }: { totalScore: number }) {
  const band = scoreBand(totalScore);
  return <Badge variant={SCORE_BAND_VARIANT[band.code]}>{band.label}</Badge>;
}
