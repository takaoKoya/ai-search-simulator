import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, getAgentByCapability, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { buildEstimate, evaluateDiscountGuard, matchCatalogItem, type CatalogItem } from "@/lib/sales/pricing";
import { checkProposalDraft } from "@/lib/sales/proposalCritic";
import { decideCriticVerdict } from "@/lib/sales/criticGate";
import { addOpportunityCost } from "@/lib/sales/cost";

interface ProposalData {
  title: string;
  executiveSummary: string;
  clientChallenges: string[];
  goals: string[];
  recommendedSolution: string;
  scope: string[];
  deliverables: string[];
  timeline: Array<{ phase: string; period: string }>;
  kpis: string[];
  assumptions: string[];
  exclusions: string[];
  risks: string[];
  nextStep: string;
}

const ProposalDraftState = Annotation.Root({
  opportunityId: lastValue<string>(),
  companyName: lastValue<string | undefined>(),
  observedProblem: lastValue<string | undefined>(),
  businessImpact: lastValue<string | undefined>(),
  expectedOutcome: lastValue<string | undefined>(),
  recommendedServices: lastValue<Array<{ service: string; reason: string }>>([]),
  proposalId: lastValue<string | undefined>(),
  proposalData: lastValue<ProposalData | undefined>(),
  estimateId: lastValue<string | undefined>(),
  unmatchedServices: lastValue<string[]>([]),
  marginRate: lastValue<number | null>(null),
  criticStatus: lastValue<string | undefined>(),
  criticShouldRetry: lastValue<boolean>(false),
  revisionCount: lastValue<number>(0),
  approvalRequestId: lastValue<string | undefined>(),
  terminalReason: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type ProposalDraftStateType = typeof ProposalDraftState.State;

/**
 * Proposal + Estimate Workflow (spec §34-50). Never completes a proposal
 * when the trigger conditions (Goal/Needs/Recommended Services) are
 * missing (spec §34) — it stops and asks for more information instead of
 * inventing content. Price always comes from `service_catalog` (spec
 * §40-41); a recommended service with no catalog match is flagged by the
 * Critic rather than silently priced.
 */
export function buildProposalDraftGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(ProposalDraftState)
    .addNode("check_trigger_conditions", async (state) => {
      const { data: opp, error } = await ctx.supabase
        .from("opportunities")
        .select("lead_id, services, need")
        .eq("id", state.opportunityId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !opp) throw error ?? new Error("Opportunity not found");

      const { data: lead } = await ctx.supabase.from("leads").select("company_name").eq("id", opp.lead_id as string).eq("tenant_id", ctx.tenantId).maybeSingle();
      const { data: hypothesis } = await ctx.supabase
        .from("lead_sales_hypotheses")
        .select("observed_problem, business_impact, expected_outcome, recommended_services")
        .eq("lead_id", opp.lead_id as string)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const recommendedServices = ((opp.services as Array<{ service: string; reason: string }> | null) ?? []).length > 0
        ? (opp.services as Array<{ service: string; reason: string }>)
        : ((hypothesis?.recommended_services as Array<{ service: string; reason: string }> | undefined) ?? []);

      if (recommendedServices.length === 0) {
        return {
          status: "completed" as GraphStatus,
          terminalReason: "推奨サービスが未確定のため提案書を作成できません（追加情報が必要）",
          currentNode: "check_trigger_conditions",
        };
      }

      return {
        companyName: (lead?.company_name as string | undefined) ?? "対象企業",
        observedProblem: (hypothesis?.observed_problem as string | undefined) ?? (opp.need as string | undefined),
        businessImpact: hypothesis?.business_impact as string | undefined,
        expectedOutcome: hypothesis?.expected_outcome as string | undefined,
        recommendedServices,
        currentNode: "check_trigger_conditions",
      };
    })
    .addNode("generate_proposal", async (state) => {
      const proposal = await runAgentStep(
        ctx,
        { agentCode: "proposal", nodeName: "generate_proposal", input: { opportunityId: state.opportunityId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("proposal_draft", {
            companyName: state.companyName,
            observedProblem: state.observedProblem,
            businessImpact: state.businessImpact,
            recommendedServices: state.recommendedServices,
            expectedOutcome: state.expectedOutcome,
          });
          return { output: result.data, summary: result.summary, result: result.data as unknown as ProposalData };
        }
      );
      await addOpportunityCost(ctx, state.opportunityId, "proposal_draft");

      const proposalAgent = await getAgentByCapability(ctx, "proposal_draft", "proposal");
      const { data: proposalRow, error } = await ctx.supabase
        .from("proposals")
        .insert({
          tenant_id: ctx.tenantId,
          opportunity_id: state.opportunityId,
          version: 1,
          status: "DRAFT",
          title: proposal.title,
          executive_summary: proposal.executiveSummary,
          client_challenges: proposal.clientChallenges,
          goals: proposal.goals,
          recommended_solution: proposal.recommendedSolution,
          scope: proposal.scope,
          deliverables: proposal.deliverables,
          timeline: proposal.timeline,
          kpis: proposal.kpis,
          assumptions: proposal.assumptions,
          exclusions: proposal.exclusions,
          risks: proposal.risks,
          next_step: proposal.nextStep,
          created_by_agent_id: proposalAgent.id,
        })
        .select("id")
        .single();
      if (error || !proposalRow) throw error ?? new Error("Failed to create proposal");

      await emitEvent(ctx, { eventType: "proposal.created", message: `${state.companyName}向けの提案書Draftを作成しました`, payload: { proposalId: proposalRow.id } });

      return { proposalId: proposalRow.id as string, proposalData: proposal, currentNode: "generate_proposal" };
    })
    .addNode("generate_estimate", async (state) => {
      const { data: catalogRows } = await ctx.supabase.from("service_catalog").select("code, name, standard_price, setup_fee, pricing_model").eq("tenant_id", ctx.tenantId).eq("is_active", true);
      const catalog: CatalogItem[] = (catalogRows ?? []).map((c) => ({
        code: c.code as string,
        name: c.name as string,
        standardPrice: c.standard_price as number,
        setupFee: c.setup_fee as number,
        pricingModel: c.pricing_model as CatalogItem["pricingModel"],
      }));

      const matched: CatalogItem[] = [];
      const unmatched: string[] = [];
      for (const rec of state.recommendedServices) {
        const item = matchCatalogItem(rec.service, catalog);
        if (item) matched.push(item);
        else unmatched.push(rec.service);
      }

      const estimateAgent = await getAgentByCapability(ctx, "pricing", "estimate");
      const result = buildEstimate({ catalogItems: matched });
      await addOpportunityCost(ctx, state.opportunityId, "estimate_draft");

      const { data: estimateRow, error } = await ctx.supabase
        .from("estimates")
        .insert({
          tenant_id: ctx.tenantId,
          proposal_id: state.proposalId,
          opportunity_id: state.opportunityId,
          version: 1,
          status: "DRAFT",
          line_items: result.lineItems,
          subtotal: result.subtotal,
          discount: result.discount,
          tax: result.tax,
          total: result.total,
          setup_fee: result.setupFee,
          monthly_fee: result.monthlyFee,
          annual_value: result.annualValue,
          payment_terms: "月末締め翌月末払い",
          created_by_agent_id: estimateAgent.id,
        })
        .select("id")
        .single();
      if (error || !estimateRow) throw error ?? new Error("Failed to create estimate");

      await emitEvent(ctx, {
        eventType: "estimate.created",
        message: `見積を作成しました（税込¥${result.total.toLocaleString()}）`,
        payload: { estimateId: estimateRow.id, total: result.total, unmatchedServices: unmatched },
      });

      return { estimateId: estimateRow.id as string, unmatchedServices: unmatched, marginRate: result.marginRate, currentNode: "generate_estimate" };
    })
    .addNode("critic_review", async (state) => {
      const proposal = state.proposalData!;
      const critic = checkProposalDraft({
        executiveSummary: proposal.executiveSummary,
        clientChallenges: proposal.clientChallenges,
        goals: proposal.goals,
        scope: proposal.scope,
        kpis: proposal.kpis,
        hasEstimate: Boolean(state.estimateId),
        unmatchedServices: state.unmatchedServices,
        marginRate: state.marginRate,
      });
      const decision = decideCriticVerdict(critic.passed, state.revisionCount);

      await ctx.supabase
        .from("proposals")
        .update({ critic_status: decision.verdict, critic_notes: critic.issues, revision_count: decision.nextRevisionCount, status: decision.verdict === "PASS" ? "WAITING_APPROVAL" : "INTERNAL_REVIEW" })
        .eq("id", state.proposalId)
        .eq("tenant_id", ctx.tenantId);

      const criticAgent = await getAgentByCapability(ctx, "critic_review", "kuro");
      await emitEvent(ctx, {
        eventType: critic.passed ? "critic.reviewed" : "critic.rejected",
        fromAgentId: criticAgent.id,
        message: critic.passed ? "Critic: 提案書の差し戻し無し" : `Critic: ${critic.issues.join(", ")}`,
        payload: { issues: critic.issues, verdict: decision.verdict },
      });

      return { criticStatus: decision.verdict, criticShouldRetry: decision.shouldRetry, revisionCount: decision.nextRevisionCount, currentNode: "critic_review" };
    })
    .addNode("request_proposal_approval", async (state) => {
      const { data: estimate } = await ctx.supabase.from("estimates").select("total, discount, subtotal").eq("id", state.estimateId).eq("tenant_id", ctx.tenantId).maybeSingle();
      const discountRate = estimate && (estimate.subtotal as number) > 0 ? (estimate.discount as number) / (estimate.subtotal as number) : 0;
      const discountGuard = evaluateDiscountGuard(discountRate);
      const highRisk = state.criticStatus !== "PASS" || discountGuard.tier === "ceo_with_reason";

      const description = [
        `会社名: ${state.companyName}`,
        `提案タイトル: ${state.proposalData!.title}`,
        `見積合計: ¥${(estimate?.total as number | undefined)?.toLocaleString() ?? "-"}`,
        `Discount Guard: ${discountGuard.tier}${discountGuard.reasonRequired ? "（理由必須）" : ""}`,
        state.unmatchedServices.length > 0 ? `価格未確定サービス: ${state.unmatchedServices.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const approvalId = await createApprovalRequest(ctx, {
        type: "proposal_approval",
        subjectType: "proposal",
        subjectId: state.proposalId!,
        title: `${state.companyName} への提案・見積承認`,
        description,
        riskLevel: highRisk ? "HIGH" : "MEDIUM",
        aiRecommendation: state.criticStatus === "PASS" ? "Criticレビュー済み。内容・価格の確認をお願いします。" : "Criticで指摘事項が残っています。",
        requestedByAgentCode: "proposal",
      });

      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "request_proposal_approval" };
    })
    .addEdge(START, "check_trigger_conditions")
    .addConditionalEdges("check_trigger_conditions", (state) => (state.status === "completed" ? "stop" : "continue"), {
      stop: END,
      continue: "generate_proposal",
    })
    .addEdge("generate_proposal", "generate_estimate")
    .addEdge("generate_estimate", "critic_review")
    .addConditionalEdges("critic_review", (state) => (state.criticShouldRetry ? "retry" : "proceed"), {
      retry: "generate_proposal",
      proceed: "request_proposal_approval",
    })
    .addEdge("request_proposal_approval", END)
    .compile({ checkpointer });
}
