import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";

const DealWonGateState = Annotation.Root({
  opportunityId: lastValue<string>(),
  clientIntentConfirmed: lastValue<boolean>(false),
  companyName: lastValue<string | undefined>(),
  missingChecks: lastValue<string[]>([]),
  approvalRequestId: lastValue<string | undefined>(),
  terminalReason: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type DealWonGateStateType = typeof DealWonGateState.State;

/**
 * WON Gate (spec §54-55): before a `deal_won` approval can even be
 * requested, the minimum checklist (Proposal Sent, Decision Maker
 * confirmed, Client Intent confirmed) must already be true. Unlike other
 * gates in this codebase, a failed check here does not create any approval
 * at all — the human has real steps to complete first (send the proposal,
 * record the decision maker), not something to approve past.
 */
export function buildDealWonGateGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(DealWonGateState)
    .addNode("check_won_conditions", async (state) => {
      const { data: opp, error } = await ctx.supabase
        .from("opportunities")
        .select("lead_id, decision_maker, stage")
        .eq("id", state.opportunityId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !opp) throw error ?? new Error("Opportunity not found");

      const { data: lead } = await ctx.supabase.from("leads").select("company_name").eq("id", opp.lead_id as string).eq("tenant_id", ctx.tenantId).maybeSingle();
      const { data: sentProposal } = await ctx.supabase
        .from("proposals")
        .select("id, status")
        .eq("opportunity_id", state.opportunityId)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const missing: string[] = [];
      if (!sentProposal || (sentProposal.status !== "SENT" && sentProposal.status !== "ACCEPTED")) {
        missing.push("Proposal Sent（提案書が送付済みであること）");
      }
      if (!opp.decision_maker) missing.push("Decision Maker確認（意思決定者の確認）");
      if (!state.clientIntentConfirmed) missing.push("Client Intent Confirmed（顧客の受諾意思確認）");

      const companyName = (lead?.company_name as string | undefined) ?? "対象企業";
      if (missing.length > 0) {
        return { companyName, missingChecks: missing, status: "completed" as GraphStatus, terminalReason: `未充足の条件があります: ${missing.join(" / ")}`, currentNode: "check_won_conditions" };
      }

      const approvalId = await createApprovalRequest(ctx, {
        type: "deal_won",
        subjectType: "opportunity",
        subjectId: state.opportunityId,
        title: `${companyName} の受注確定承認`,
        description: "Proposal Sent / Decision Maker確認 / Client Intent Confirmed のいずれも充足しています。受注確定後、既存の契約レビューWorkflowへ接続されます。",
        riskLevel: "LOW",
        aiRecommendation: "全ての受注前提条件を確認済みです。受注確定を推奨します。",
        requestedByAgentCode: "sales",
      });
      await emitEvent(ctx, { eventType: "opportunity.won_gate_passed", message: `${companyName}が受注確定の前提条件を満たしました`, payload: { opportunityId: state.opportunityId } });

      return { companyName, approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "check_won_conditions" };
    })
    .addEdge(START, "check_won_conditions")
    .addEdge("check_won_conditions", END)
    .compile({ checkpointer });
}
