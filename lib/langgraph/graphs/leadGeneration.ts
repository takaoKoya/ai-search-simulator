import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, getAgentByCode, recordHandoff, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";

const LeadGenerationState = Annotation.Root({
  leadId: lastValue<string>(),
  companyName: lastValue<string>(),
  industry: lastValue<string>(),
  findings: lastValue<Record<string, unknown> | undefined>(),
  opportunityId: lastValue<string | undefined>(),
  pitch: lastValue<string | undefined>(),
  amount: lastValue<number | undefined>(),
  criticPassed: lastValue<boolean | undefined>(),
  criticIssues: lastValue<string[] | undefined>(),
  approvalRequestId: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type LeadGenerationStateType = typeof LeadGenerationState.State;

export function buildLeadGenerationGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(LeadGenerationState)
    .addNode("research", async (state) => {
      const data = await runAgentStep(
        ctx,
        { agentCode: "research", nodeName: "research", input: { leadId: state.leadId, companyName: state.companyName } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("company_research", {
            companyName: state.companyName,
            industry: state.industry,
          });
          await ctx.supabase.from("findings").insert({
            tenant_id: ctx.tenantId,
            lead_id: state.leadId,
            agent_id: agent.id,
            type: "company_research",
            payload: result.data,
          });
          await ctx.supabase
            .from("leads")
            .update({ status: "researched", score: (result.data.digitalScore as number) ?? null })
            .eq("id", state.leadId)
            .eq("tenant_id", ctx.tenantId);
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      return { findings: data, currentNode: "research" };
    })
    .addNode("sales_strategy", async (state) => {
      await recordHandoff(ctx, {
        fromAgentCode: "research",
        toAgentCode: "sales",
        message: `${state.companyName}の調査結果をセールへ共有`,
        payload: { leadId: state.leadId },
      });
      const findings = state.findings ?? {};
      const data = await runAgentStep(
        ctx,
        { agentCode: "sales", nodeName: "sales_strategy", input: { leadId: state.leadId, findings } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("sales_strategy", {
            companyName: state.companyName,
            weaknesses: findings.weaknesses,
            digitalScore: findings.digitalScore,
          });
          const { data: oppRow, error } = await ctx.supabase
            .from("opportunities")
            .insert({
              tenant_id: ctx.tenantId,
              lead_id: state.leadId,
              sales_agent_id: agent.id,
              amount: result.data.amount,
              currency: result.data.currency,
              notes: result.data.pitch,
              stage: "candidate",
              status: "open",
            })
            .select("id")
            .single();
          if (error || !oppRow) throw error ?? new Error("Failed to create opportunity");
          await ctx.supabase.from("leads").update({ status: "sales_drafted" }).eq("id", state.leadId).eq("tenant_id", ctx.tenantId);
          return {
            output: { ...result.data, opportunityId: oppRow.id },
            summary: result.summary,
            result: { ...result.data, opportunityId: oppRow.id as string } as Record<string, unknown> & { opportunityId: string },
          };
        }
      );
      return { pitch: data.pitch as string, amount: data.amount as number, opportunityId: data.opportunityId as string, currentNode: "sales_strategy" };
    })
    .addNode("critic", async (state) => {
      await recordHandoff(ctx, {
        fromAgentCode: "sales",
        toAgentCode: "kuro",
        message: "営業候補のレビュー依頼",
        payload: { opportunityId: state.opportunityId },
      });
      const data = await runAgentStep(
        ctx,
        { agentCode: "kuro", nodeName: "critic_review", input: { opportunityId: state.opportunityId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("critic_review", { subjectSummary: state.pitch ?? "" });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      const passed = Boolean(data.passed);
      const issues = (data.issues as string[]) ?? [];
      if (!passed) {
        const criticAgent = await getAgentByCode(ctx, "kuro");
        await ctx.supabase.from("decision_memories").insert({
          tenant_id: ctx.tenantId,
          category: "critic_rejection",
          note: `Critic差し戻し: ${issues.join(", ")}`,
        });
        await emitEvent(ctx, {
          eventType: "critic.rejected",
          fromAgentId: criticAgent.id,
          message: "Criticが差し戻しを判断",
          payload: { issues },
        });
      }
      return { criticPassed: passed, criticIssues: issues, currentNode: "critic" };
    })
    .addNode("request_approval", async (state) => {
      const approvalId = await createApprovalRequest(ctx, {
        type: "sales_outreach",
        subjectType: "opportunity",
        subjectId: state.opportunityId!,
        title: `${state.companyName} への営業提案承認`,
        description: state.pitch,
        riskLevel: state.criticPassed ? "LOW" : "MEDIUM",
        aiRecommendation: state.criticPassed ? "Criticレビュー済み。承認を推奨します。" : "Critic指摘事項の確認を推奨します。",
        requestedByAgentCode: "sales",
      });
      await ctx.supabase
        .from("opportunities")
        .update({ status: "pending_approval" })
        .eq("id", state.opportunityId)
        .eq("tenant_id", ctx.tenantId);
      await ctx.supabase.from("leads").update({ status: "in_review" }).eq("id", state.leadId).eq("tenant_id", ctx.tenantId);
      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "request_approval" };
    })
    .addEdge(START, "research")
    .addEdge("research", "sales_strategy")
    .addEdge("sales_strategy", "critic")
    .addEdge("critic", "request_approval")
    .addEdge("request_approval", END)
    .compile({ checkpointer });
}
