/**
 * Upsell Detection / Critic (Growth Loop spec §72-82, §140-143). Pure
 * functions — the actual DB dedupe/cooldown queries live in the graph node
 * (lib/langgraph/graphs/renewal.ts), which calls these with the rows it
 * already fetched.
 */

export interface UpsellCandidate {
  clientId: string;
  recommendedService: string;
  problem: string;
  businessImpact?: string | null;
}

export interface ExistingUpsellRow {
  clientId: string;
  recommendedService: string;
  status: string;
  cooldownUntil: string | null; // ISO date
}

const OPEN_STATUSES = ["DETECTED", "INTERNAL_REVIEW", "APPROVAL_PENDING", "APPROVED", "PROPOSED"];

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason: string | null;
}

/**
 * Duplicate Recommendation guard (spec §140-141): never re-detect the same
 * client+service while an existing candidate is still open, or while a
 * previously-rejected one is inside its cooldown window.
 */
export function checkUpsellDuplicate(candidate: UpsellCandidate, existing: ExistingUpsellRow[], today: Date): DuplicateCheckResult {
  const sameClientService = existing.filter((e) => e.clientId === candidate.clientId && e.recommendedService === candidate.recommendedService);

  const openMatch = sameClientService.find((e) => OPEN_STATUSES.includes(e.status));
  if (openMatch) return { isDuplicate: true, reason: `同一クライアント・同一サービスの提案が既に${openMatch.status}状態で存在する` };

  const cooldownMatch = sameClientService.find((e) => e.status === "REJECTED" && e.cooldownUntil != null && new Date(e.cooldownUntil).getTime() > today.getTime());
  if (cooldownMatch) return { isDuplicate: true, reason: `直近のReject後のCooldown期間中(${cooldownMatch.cooldownUntil}まで)` };

  return { isDuplicate: false, reason: null };
}

export interface UpsellCriticInput extends UpsellCandidate {
  /** Services already covered by the client's current contract scope. */
  currentContractServices: string[];
  /** Recent (rolling window) count of expansion proposals already made to this client — Client Fatigue guard (spec §142). */
  recentProposalsInWindow: number;
  maxProposalsPerPeriod: number;
}

export interface UpsellCriticResult {
  passed: boolean;
  issues: string[];
}

/**
 * Upsell Critic (spec §76-77, §142-143): rejects a candidate that is already
 * inside the existing contract's scope (not a real upsell — Test Case E),
 * lacks a stated client benefit, or would exceed the tenant's fatigue limit.
 */
export function criticUpsellCandidate(input: UpsellCriticInput): UpsellCriticResult {
  const issues: string[] = [];

  const alreadyInScope = input.currentContractServices.some((s) => s.toUpperCase() === input.recommendedService.toUpperCase());
  if (alreadyInScope) issues.push("推奨サービスは既存契約のScope内であり、新規アップセルではない");

  if (!input.problem || input.problem.trim().length === 0) issues.push("課題(problem)の根拠が記載されていない");

  if (!input.businessImpact || input.businessImpact.trim().length === 0) issues.push("Client Benefit(business_impact)が明記されていない — 売れるからではなく顧客のGoal達成に必要かを示す必要がある");

  if (input.recentProposalsInWindow >= input.maxProposalsPerPeriod) {
    issues.push(`直近期間の提案数が上限(${input.maxProposalsPerPeriod}件)に達しており、Client Fatigueのリスクがある`);
  }

  return { passed: issues.length === 0, issues };
}

/** Upsell Cooldown (spec §141): default 90 days after a human reject. */
export function computeCooldownUntil(rejectedAt: Date, days = 90): Date {
  return new Date(rejectedAt.getTime() + days * 86_400_000);
}
