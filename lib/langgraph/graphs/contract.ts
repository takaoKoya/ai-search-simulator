import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { computeSlaForEvent } from "@/lib/server/slaEngine";

const ContractState = Annotation.Root({
  opportunityId: lastValue<string>(),
  companyName: lastValue<string>(),
  amount: lastValue<number | undefined>(),
  contractId: lastValue<string | undefined>(),
  riskLevel: lastValue<string | undefined>(),
  approvalRequestId: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type ContractStateType = typeof ContractState.State;

export function buildContractGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(ContractState)
    .addNode("contract_review", async (state) => {
      const data = await runAgentStep(
        ctx,
        { agentCode: "contract", nodeName: "contract_review", input: { opportunityId: state.opportunityId, amount: state.amount } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("contract_review", { amount: state.amount });
          const { data: contractRow, error } = await ctx.supabase
            .from("contracts")
            .insert({
              tenant_id: ctx.tenantId,
              opportunity_id: state.opportunityId,
              terms: { amount: state.amount, findings: result.data.findings },
              risk_level: result.data.riskLevel,
              risk_findings: result.data.findings,
              status: "pending_approval",
              reviewed_by_agent_id: agent.id,
            })
            .select("id")
            .single();
          if (error || !contractRow) throw error ?? new Error("Failed to create contract");
          return {
            output: result.data,
            summary: result.summary,
            result: { ...result.data, contractId: contractRow.id as string } as Record<string, unknown> & { contractId: string },
          };
        }
      );
      const riskLevel = data.riskLevel as string;
      await emitEvent(ctx, {
        eventType: "contract.reviewed",
        message: `${state.companyName}との契約内容を抽出(Risk: ${riskLevel})`,
        payload: { contractId: data.contractId, riskLevel },
      });
      if (riskLevel !== "LOW") {
        await emitEvent(ctx, {
          eventType: "contract.risk_detected",
          message: `契約リスクを検出(${riskLevel})`,
          payload: { contractId: data.contractId, riskLevel, findings: data.findings },
        });
      }
      return { contractId: data.contractId, riskLevel, currentNode: "contract_review" };
    })
    .addNode("request_approval", async (state) => {
      const highRisk = state.riskLevel === "HIGH" || state.riskLevel === "CRITICAL";

      // Business-Time-aware SLA (spec §61-64): only a high-risk contract
      // review has a matching sla_policies row (entity_type=
      // 'approval_request', event_type='contract_high_risk') — a LOW/MEDIUM
      // risk contract gets no SLA due date, never a fabricated one.
      const sla = highRisk ? await computeSlaForEvent(ctx, { entityType: "approval_request", eventType: "contract_high_risk", startAt: new Date() }) : null;

      const approvalId = await createApprovalRequest(ctx, {
        type: "contract_approval",
        subjectType: "contract",
        subjectId: state.contractId!,
        title: `${state.companyName} との契約承認`,
        riskLevel: state.riskLevel,
        aiRecommendation: highRisk ? "リスクが高いため慎重な確認を推奨します。" : "リスクは許容範囲内。承認を推奨します。",
        requestedByAgentCode: "contract",
        slaDueAt: sla?.dueAt.toISOString(),
      });
      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "request_approval" };
    })
    .addEdge(START, "contract_review")
    .addEdge("contract_review", "request_approval")
    .addEdge("request_approval", END)
    .compile({ checkpointer });
}
