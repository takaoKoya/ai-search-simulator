import type { GraphRunCtx } from "@/lib/langgraph/context";

/**
 * Nominal simulated per-stage AI cost (spec §16/§68 "AI Cost tracking").
 * TemplateProvider makes no real network calls, so there is no real token
 * bill to read yet — these constants exist so the Cost Gate / cost-tracking
 * UI has a genuine, consistently-accumulated number today, and a single
 * place to replace with real usage-based costs once a billed provider is
 * wired in (see lib/ai/provider.ts).
 */
export const STAGE_COST_YEN = {
  basic_research: 5,
  website_check: 8,
  lead_scoring: 2,
  deep_research: 30,
  sales_hypothesis: 15,
  critic_review: 5,
  sales_draft: 10,
} as const;

export type CostStage = keyof typeof STAGE_COST_YEN;

export async function addLeadCost(ctx: GraphRunCtx, leadId: string, stage: CostStage): Promise<void> {
  const delta = STAGE_COST_YEN[stage];
  const { data, error } = await ctx.supabase.from("leads").select("ai_cost_yen").eq("id", leadId).eq("tenant_id", ctx.tenantId).single();
  if (error) throw error;
  const current = (data?.ai_cost_yen as number | undefined) ?? 0;
  const { error: updateError } = await ctx.supabase
    .from("leads")
    .update({ ai_cost_yen: current + delta })
    .eq("id", leadId)
    .eq("tenant_id", ctx.tenantId);
  if (updateError) throw updateError;
}
