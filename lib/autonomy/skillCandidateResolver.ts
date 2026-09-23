/**
 * SkillCandidateResolver (spec FINAL CHANGE 6) — the boundary between the
 * Skill Registry and the Planner. The Planner is never handed the full
 * registry; it only ever sees a bounded, filtered candidate list produced
 * here. PHASE 1's filter is deliberately simple rule-based matching
 * (enabled + optional department + optional risk ceiling), but the query
 * shape (indexed columns, a hard `limit`) is what keeps this correct at
 * 100/500/1000+ skills later — this function's contract does not change
 * as the registry grows, only its result set does.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import type { SkillDefinitionSummary } from "@/lib/autonomy/types";

const RISK_RANK: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const DEFAULT_LIMIT = 20;

export interface SkillCandidateParams {
  department?: string;
  maxRiskLevel?: "LOW" | "MEDIUM" | "HIGH";
  limit?: number;
}

export async function resolveCandidateSkills(supabase: SupabaseServerClient, tenantId: string, params: SkillCandidateParams = {}): Promise<SkillDefinitionSummary[]> {
  let query = supabase
    .from("skill_definitions")
    .select("id, name, description, department, risk_level, executor_ref")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .limit(params.limit ?? DEFAULT_LIMIT);

  if (params.department) query = query.eq("department", params.department);

  const { data, error } = await query;
  if (error) throw error;

  const maxRank = params.maxRiskLevel ? RISK_RANK[params.maxRiskLevel] : undefined;
  const rows = (data ?? []).filter((row) => maxRank === undefined || (RISK_RANK[row.risk_level as string] ?? 99) <= maxRank);

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    department: (row.department as string | null) ?? null,
    riskLevel: row.risk_level as string,
    executorRef: row.executor_ref as string,
  }));
}
