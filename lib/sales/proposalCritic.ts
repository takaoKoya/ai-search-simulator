/**
 * Proposal Critic checklist (spec §47) as a pure function, mirroring
 * `outreachCritic.ts`'s style: Needs/Goal/Scope/Price/Schedule/KPI
 * alignment, evidence, exaggeration, missing info, and margin.
 */

const BANNED_CLAIM_PATTERN = /断言|保証|確実に|100%|絶対|必ず成功|実績多数|業界No\.?1/;

export interface ProposalCriticInput {
  executiveSummary: string;
  clientChallenges: unknown[];
  goals: unknown[];
  scope: unknown[];
  kpis: unknown[];
  hasEstimate: boolean;
  unmatchedServices: string[]; // recommended services with no Price Master entry
  marginRate: number | null;
}

export interface ProposalCriticResult {
  passed: boolean;
  issues: string[];
}

export function checkProposalDraft(input: ProposalCriticInput): ProposalCriticResult {
  const issues: string[] = [];

  if (input.clientChallenges.length === 0) issues.push("NEEDS: 顧客の課題(Needs)が記載されていません。");
  if (input.goals.length === 0) issues.push("GOAL: ゴールが記載されていません。");
  if (input.scope.length === 0) issues.push("SCOPE: 対応範囲(Scope)が空です。");
  if (!input.hasEstimate) issues.push("PRICE: 見積が紐づいていません。");
  if (input.kpis.length === 0) issues.push("KPI: KPIが記載されていません。");
  if (BANNED_CLAIM_PATTERN.test(input.executiveSummary)) issues.push("CLAIM_RISK: 誇張・断定的な表現、根拠のない成果保証を含みます。");
  if (input.unmatchedServices.length > 0) {
    issues.push(`PRICE: 価格マスタに存在しないサービスが含まれています（未確定価格は提示できません）: ${input.unmatchedServices.join(", ")}`);
  }
  if (input.marginRate != null && input.marginRate < 0) {
    issues.push("MARGIN: この見積は原価割れしています。CEOの確認が必要です。");
  }

  return { passed: issues.length === 0, issues };
}
