import { Badge } from "@/components/ui/badge";
import type { IdeaTier } from "@/lib/growth-os/types";

const SUCCESS_STATUSES = new Set(["APPROVED", "PUBLISHED", "DONE", "SUCCEEDED", "READY", "LAUNCHED", "PASS"]);
const WARNING_STATUSES = new Set(["WAITING_APPROVAL", "ON_HOLD", "PENDING", "NEEDS_REVISION", "RUNNING", "REVIEWED"]);
const CRITICAL_STATUSES = new Set(["REJECTED", "FAILED", "FAIL", "ARCHIVED"]);

export function StatusBadge({ status }: { status: string }) {
  const variant = SUCCESS_STATUSES.has(status) ? "success" : WARNING_STATUSES.has(status) ? "warning" : CRITICAL_STATUSES.has(status) ? "critical" : "neutral";

  return <Badge variant={variant}>{status}</Badge>;
}

const TIER_VARIANT: Record<IdeaTier, "success" | "accent" | "warning" | "critical"> = {
  TOP: "success",
  CANDIDATE: "accent",
  HOLD: "warning",
  REJECT: "critical",
};

const TIER_LABEL: Record<IdeaTier, string> = {
  TOP: "TOP 最優先",
  CANDIDATE: "CANDIDATE 制作候補",
  HOLD: "HOLD 保留",
  REJECT: "REJECT 原則不採用",
};

export function TierBadge({ tier }: { tier: IdeaTier }) {
  return <Badge variant={TIER_VARIANT[tier]}>{TIER_LABEL[tier]}</Badge>;
}
