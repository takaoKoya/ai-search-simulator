/**
 * Renewal Management (Growth Loop spec §62-71): date-driven due detection +
 * a deterministic, explained (never black-box, spec §67) health score.
 */

export type RenewalDueStatus = "NOT_DUE" | "UPCOMING";

export interface RenewalDueResult {
  status: RenewalDueStatus;
  daysUntilEnd: number;
  noticeDeadline: Date | null;
}

/**
 * Renewal Trigger (spec §64): a contract enters UPCOMING once it is within
 * the earliest of the tenant's configured trigger windows (default 90/60/30
 * days) of its end date — never earlier, so the Renewal Center doesn't fill
 * with noise a year in advance.
 */
export function computeRenewalDueStatus(currentEndDate: Date, today: Date, triggerDaysList: number[] = [90, 60, 30], noticePeriodDays = 30): RenewalDueResult {
  const daysUntilEnd = Math.round((currentEndDate.getTime() - today.getTime()) / 86_400_000);
  const earliestTrigger = Math.max(...triggerDaysList);
  const status: RenewalDueStatus = daysUntilEnd <= earliestTrigger ? "UPCOMING" : "NOT_DUE";
  const noticeDeadline = new Date(currentEndDate.getTime() - noticePeriodDays * 86_400_000);
  return { status, daysUntilEnd, noticeDeadline };
}

export type RenewalHealthLevel = "GREEN" | "YELLOW" | "RED";

export interface RenewalHealthFactors {
  /** 0-1: share of tracked KPIs currently ON_TARGET or NEAR_TARGET. */
  kpiAchievementRatio: number | null;
  openCriticalIssues: number;
  missedMeetingsCount: number;
  clientSentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  paymentOverdue: boolean;
  marginRate: number | null;
}

export interface RenewalHealthResult {
  level: RenewalHealthLevel;
  reasons: string[];
}

/**
 * Renewal Health Score (spec §66-67): each factor contributes explained
 * points to a risk tally — the result always carries a human-readable
 * `reasons` list rather than a bare score, per "ブラックボックスにしない".
 */
export function computeRenewalHealth(factors: RenewalHealthFactors): RenewalHealthResult {
  const reasons: string[] = [];
  let riskPoints = 0;

  if (factors.kpiAchievementRatio != null) {
    if (factors.kpiAchievementRatio < 0.4) {
      riskPoints += 2;
      reasons.push(`KPI達成率が${Math.round(factors.kpiAchievementRatio * 100)}%と低い`);
    } else if (factors.kpiAchievementRatio < 0.7) {
      riskPoints += 1;
      reasons.push(`KPI達成率が${Math.round(factors.kpiAchievementRatio * 100)}%にとどまっている`);
    }
  }

  if (factors.openCriticalIssues > 0) {
    riskPoints += factors.openCriticalIssues >= 2 ? 2 : 1;
    reasons.push(`未解決のCritical Issueが${factors.openCriticalIssues}件`);
  }

  if (factors.missedMeetingsCount > 0) {
    riskPoints += factors.missedMeetingsCount >= 2 ? 2 : 1;
    reasons.push(`Client Meeting欠席${factors.missedMeetingsCount}回`);
  }

  if (factors.clientSentiment === "NEGATIVE") {
    riskPoints += 2;
    reasons.push("直近のClient Feedbackがネガティブ");
  }

  if (factors.paymentOverdue) {
    riskPoints += 2;
    reasons.push("支払いが遅延している");
  }

  if (factors.marginRate != null && factors.marginRate < 0.2) {
    riskPoints += 1;
    reasons.push(`粗利率が${Math.round(factors.marginRate * 100)}%と低い`);
  }

  if (reasons.length === 0) reasons.push("特筆すべきリスク要因なし");

  const level: RenewalHealthLevel = riskPoints >= 4 ? "RED" : riskPoints >= 1 ? "YELLOW" : "GREEN";
  return { level, reasons };
}
