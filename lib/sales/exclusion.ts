export interface IcpTargeting {
  target_industries: string[];
  target_regions: string[];
  exclusion_conditions: string[];
}

export interface ExclusionResult {
  excluded: boolean;
  reason?: string;
}

/**
 * Hard exclusion (spec §20): a high score never overrides this. Only
 * explicit `exclusion_conditions`, a configured target-industry list that
 * doesn't include the candidate's industry, or a configured target-region
 * list (without a "全国" wildcard) that doesn't include the candidate's
 * region trigger exclusion. An empty target list means "no restriction",
 * and an unknown candidate field is never treated as a reason to exclude —
 * unknown is scored low, not blocked.
 */
export function checkHardExclusion(
  candidate: { industry: string | null; region: string | null },
  icp: IcpTargeting
): ExclusionResult {
  if (candidate.industry && icp.exclusion_conditions.includes(candidate.industry)) {
    return { excluded: true, reason: `除外条件(業種)に一致: ${candidate.industry}` };
  }
  if (candidate.industry && icp.target_industries.length > 0 && !icp.target_industries.includes(candidate.industry)) {
    return { excluded: true, reason: `対象業種外: ${candidate.industry}` };
  }
  if (
    candidate.region &&
    icp.target_regions.length > 0 &&
    !icp.target_regions.includes("全国") &&
    !icp.target_regions.includes(candidate.region)
  ) {
    return { excluded: true, reason: `対象地域外: ${candidate.region}` };
  }
  return { excluded: false };
}
