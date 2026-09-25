import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";

const SalesState = Annotation.Root({
  opportunityId: lastValue<string>(),
  leadId: lastValue<string>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type SalesStateType = typeof SalesState.State;

/**
 * Runs after a human has approved a sales_outreach approval_request.
 * Phase 1 skips outreach/meeting/negotiation (no external send) and moves
 * straight to WON, per the product brief.
 */
export function buildSalesGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(SalesState)
    .addNode("finalize_won", async (state) => {
      await ctx.supabase.from("opportunities").update({ status: "won" }).eq("id", state.opportunityId).eq("tenant_id", ctx.tenantId);
      await ctx.supabase.from("leads").update({ status: "won" }).eq("id", state.leadId).eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, { eventType: "opportunity.won", message: "商談がWONになりました" });
      return { status: "completed" as GraphStatus, currentNode: "finalize_won" };
    })
    .addEdge(START, "finalize_won")
    .addEdge("finalize_won", END)
    .compile({ checkpointer });
}
