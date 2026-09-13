import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, getAgentByCode, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { decideCriticVerdict } from "@/lib/sales/criticGate";
import { addLeadCost } from "@/lib/sales/cost";

const SalesDraftState = Annotation.Root({
  leadId: lastValue<string>(),
  companyName: lastValue<string | undefined>(),
  observedProblem: lastValue<string | undefined>(),
  recommendedServices: lastValue<Array<{ service: string; reason: string }>>([]),
  draftId: lastValue<string | undefined>(),
  draftBody: lastValue<string | undefined>(),
  criticStatus: lastValue<string | undefined>(),
  criticShouldRetry: lastValue<boolean>(false),
  revisionCount: lastValue<number>(0),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type SalesDraftStateType = typeof SalesDraftState.State;

/**
 * Runs after CEO approval of a sales_lead (lead.discovery_stage =
 * READY_FOR_OUTREACH). Produces a Draft only — no email/DM/form is ever sent
 * (spec §47/§50 External Send Gate is intentionally not implemented here).
 */
export function buildSalesDraftGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(SalesDraftState)
    .addNode("load_context", async (state) => {
      const { data: lead, error } = await ctx.supabase
        .from("leads")
        .select("company_name")
        .eq("id", state.leadId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !lead) throw error ?? new Error("Lead not found");

      const { data: hypothesis } = await ctx.supabase
        .from("lead_sales_hypotheses")
        .select("observed_problem, recommended_services")
        .eq("lead_id", state.leadId)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        companyName: lead.company_name as string,
        observedProblem: (hypothesis?.observed_problem as string | undefined) ?? undefined,
        recommendedServices: (hypothesis?.recommended_services as Array<{ service: string; reason: string }> | undefined) ?? [],
        currentNode: "load_context",
      };
    })
    .addNode("generate_draft", async (state) => {
      const draft = await runAgentStep(
        ctx,
        { agentCode: "writer", nodeName: "generate_draft", input: { leadId: state.leadId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("sales_draft", {
            companyName: state.companyName,
            observedProblem: state.observedProblem,
            recommendedServices: state.recommendedServices,
          });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId, "sales_draft");

      if (state.draftId) {
        await ctx.supabase
          .from("sales_drafts")
          .update({ subject: draft.subject, body: draft.body, status: "draft" })
          .eq("id", state.draftId)
          .eq("tenant_id", ctx.tenantId);
        return { draftBody: draft.body as string, currentNode: "generate_draft" };
      }

      const writerAgent = await getAgentByCode(ctx, "writer");
      const { data: draftRow, error } = await ctx.supabase
        .from("sales_drafts")
        .insert({
          tenant_id: ctx.tenantId,
          lead_id: state.leadId,
          channel: draft.channel ?? "email",
          subject: draft.subject,
          body: draft.body,
          status: "draft",
          created_by_agent_id: writerAgent.id,
        })
        .select("id")
        .single();
      if (error || !draftRow) throw error ?? new Error("Failed to create sales draft");
      await emitEvent(ctx, { eventType: "sales_draft.created", message: `${state.companyName}向け営業文Draftを作成`, payload: { draftId: draftRow.id } });
      return { draftId: draftRow.id as string, draftBody: draft.body as string, currentNode: "generate_draft" };
    })
    .addNode("critic_review_draft", async (state) => {
      const body = state.draftBody ?? "";
      const critic = await runAgentStep(
        ctx,
        { agentCode: "kuro", nodeName: "critic_review_draft", input: { draftId: state.draftId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("critic_review", { subjectSummary: body, draftLength: body.length });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId, "critic_review");
      const passed = Boolean(critic.passed);
      const issues = (critic.issues as string[]) ?? [];
      const decision = decideCriticVerdict(passed, state.revisionCount);

      await ctx.supabase
        .from("sales_drafts")
        .update({
          status: decision.verdict === "PASS" ? "DRAFT_READY" : "revision_required",
          critic_status: decision.verdict,
          critic_notes: issues,
        })
        .eq("id", state.draftId)
        .eq("tenant_id", ctx.tenantId);

      await emitEvent(ctx, {
        eventType: passed ? "critic.reviewed" : "critic.rejected",
        message: passed ? "Critic: Draft差し戻し無し" : `Critic: Draftへ${issues.join(", ")}`,
        payload: { issues, verdict: decision.verdict },
      });

      return {
        criticStatus: decision.verdict,
        criticShouldRetry: decision.shouldRetry,
        revisionCount: decision.nextRevisionCount,
        currentNode: "critic_review_draft",
      };
    })
    .addNode("finalize", async (state) => {
      if (state.criticStatus === "PASS") {
        await emitEvent(ctx, { eventType: "sales_draft.ready", message: `${state.companyName}向け営業文がDRAFT_READYになりました`, payload: { draftId: state.draftId } });
      }
      return { status: "completed" as GraphStatus, currentNode: "finalize" };
    })
    .addEdge(START, "load_context")
    .addEdge("load_context", "generate_draft")
    .addEdge("generate_draft", "critic_review_draft")
    .addConditionalEdges("critic_review_draft", (state) => (state.criticShouldRetry ? "retry" : "proceed"), {
      retry: "generate_draft",
      proceed: "finalize",
    })
    .addEdge("finalize", END)
    .compile({ checkpointer });
}
