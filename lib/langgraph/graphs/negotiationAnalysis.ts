import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { addOpportunityCost } from "@/lib/sales/cost";

const NegotiationAnalysisState = Annotation.Root({
  opportunityId: lastValue<string>(),
  reactionCategory: lastValue<string>(),
  note: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type NegotiationAnalysisStateType = typeof NegotiationAnalysisState.State;

/**
 * Negotiation (spec §51-52): records the client's reaction and has the
 * Negotiation Agent lay out the discussion points. It never confirms an
 * actual discount — `suggestedMaxDiscountRate` is a ceiling for a human to
 * consider, not a commitment (the real discount, if any, is applied when a
 * new Estimate/Proposal is drafted and goes through `proposal_approval`
 * again). The reaction itself reuses `findings` (type='negotiation_item')
 * rather than a new table.
 */
export function buildNegotiationAnalysisGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(NegotiationAnalysisState)
    .addNode("analyze_reaction", async (state) => {
      const { data: opp, error } = await ctx.supabase
        .from("opportunities")
        .select("lead_id, estimated_value, confirmed_value")
        .eq("id", state.opportunityId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !opp) throw error ?? new Error("Opportunity not found");

      const analysis = await runAgentStep(
        ctx,
        { agentCode: "negotiator", nodeName: "analyze_reaction", input: { opportunityId: state.opportunityId, reactionCategory: state.reactionCategory } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("negotiation_analysis", {
            reactionCategory: state.reactionCategory,
            estimatedValue: (opp.confirmed_value as number | null) ?? (opp.estimated_value as number | null) ?? 0,
          });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addOpportunityCost(ctx, state.opportunityId, "negotiation_analysis");

      await ctx.supabase.from("findings").insert({
        tenant_id: ctx.tenantId,
        lead_id: opp.lead_id,
        type: "negotiation_item",
        payload: { opportunityId: state.opportunityId, reactionCategory: state.reactionCategory, note: state.note ?? null, ...analysis },
      });

      await ctx.supabase.from("opportunities").update({ stage: "NEGOTIATION" }).eq("id", state.opportunityId).eq("tenant_id", ctx.tenantId);

      await emitEvent(ctx, {
        eventType: "negotiation.item_logged",
        message: `交渉論点を記録・整理しました: ${state.reactionCategory}`,
        payload: { reactionCategory: state.reactionCategory, requiresCeoJudgment: true },
      });

      return { status: "completed" as GraphStatus, currentNode: "analyze_reaction" };
    })
    .addEdge(START, "analyze_reaction")
    .addEdge("analyze_reaction", END)
    .compile({ checkpointer });
}
