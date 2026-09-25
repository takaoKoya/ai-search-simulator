import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { computeApprovalSteps, loadApprovalPolicies } from "@/lib/server/approvalPolicy";
import { computeRenewalDueStatus, computeRenewalHealth } from "@/lib/server/renewalRisk";
import { checkUpsellDuplicate, criticUpsellCandidate, type ExistingUpsellRow } from "@/lib/server/upsell";

const RenewalState = Annotation.Root({
  projectId: lastValue<string>(),
  companyName: lastValue<string>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
  renewalId: lastValue<string | undefined>(),
  upsellOpportunityIds: lastValue<string[]>([]),
});

export type RenewalStateType = typeof RenewalState.State;

/** Client Fatigue guard (spec §142) — deferred to a tenant setting in a later phase; a safe constant for now. */
const DEFAULT_MAX_EXPANSION_PROPOSALS_PER_PERIOD = 2;
const FATIGUE_WINDOW_DAYS = 30;

function inferUpsellService(kpiName: string): string {
  const n = kpiName.toUpperCase();
  if (n.includes("CV") || n.includes("CONVERSION") || n.includes("問い合わせ") || n.includes("CRO")) return "CRO";
  if (n.includes("AIO") || n.includes("GEO") || n.includes("AEO")) return "AIO";
  if (n.includes("AD") || n.includes("広告") || n.includes("CPA")) return "Ads";
  return "SEO";
}

/**
 * Growth Loop: Renewal Due Detection + Health Score (spec §62-71) followed by
 * Upsell Detection -> Critic -> Approval (spec §72-82). Renewal and Upsell
 * are kept in one graph because both read the same "how is this account
 * doing" data — see spec §83 for why they must never be confused with each
 * other in their *outcome* (continuation vs. expansion) even though the
 * detection pass is shared.
 */
export function buildRenewalGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(RenewalState)
    .addNode("check_renewal_due", async (state) => {
      const { data: project } = await ctx.supabase.from("projects").select("contract_id, client_id").eq("id", state.projectId).eq("tenant_id", ctx.tenantId).single();
      if (!project?.contract_id) return { currentNode: "check_renewal_due" };

      const { data: contract } = await ctx.supabase.from("contracts").select("id, end_date, notice_period_days").eq("id", project.contract_id as string).eq("tenant_id", ctx.tenantId).maybeSingle();
      if (!contract?.end_date) return { currentNode: "check_renewal_due" };

      const currentEndDate = new Date(contract.end_date as string);
      const due = computeRenewalDueStatus(currentEndDate, new Date(), [90, 60, 30], (contract.notice_period_days as number) ?? 30);

      // Renewal Health Score (spec §66-67) — deterministic factors this
      // vertical slice can actually compute from existing data; margin/
      // payment/meeting-attendance tracking are noted as known limitations
      // (no cost-tracking or attendance system exists yet) and simply don't
      // contribute a risk point when unavailable, rather than being guessed.
      const { data: kpis } = await ctx.supabase.from("kpis").select("current_value, target_value").eq("project_id", state.projectId).eq("tenant_id", ctx.tenantId);
      const kpisWithTarget = (kpis ?? []).filter((k) => k.target_value != null && k.current_value != null);
      const onTargetCount = kpisWithTarget.filter((k) => (k.current_value as number) >= (k.target_value as number) * 0.8).length;
      const kpiAchievementRatio = kpisWithTarget.length > 0 ? onTargetCount / kpisWithTarget.length : null;

      const { data: criticalAnomalies } = await ctx.supabase.from("anomaly_events").select("id").eq("project_id", state.projectId).eq("tenant_id", ctx.tenantId).eq("severity", "CRITICAL").eq("acknowledged", false);

      const health = computeRenewalHealth({
        kpiAchievementRatio,
        openCriticalIssues: (criticalAnomalies ?? []).length,
        missedMeetingsCount: 0,
        clientSentiment: null,
        paymentOverdue: false,
        marginRate: null,
      });

      const { data: renewal, error } = await ctx.supabase
        .from("contract_renewals")
        .upsert(
          {
            tenant_id: ctx.tenantId,
            contract_id: contract.id,
            project_id: state.projectId,
            current_end_date: contract.end_date,
            notice_deadline: due.noticeDeadline?.toISOString().slice(0, 10) ?? null,
            status: due.status,
            risk_level: health.level,
            risk_factors: { reasons: health.reasons },
          },
          { onConflict: "tenant_id,contract_id,current_end_date" }
        )
        .select("id")
        .single();
      if (error || !renewal) throw error ?? new Error("Failed to upsert contract_renewal");

      await runAgentStep(
        ctx,
        { agentCode: "renewal", nodeName: "renewal_readiness", input: { contractId: contract.id }, projectId: state.projectId },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const res = await provider.generate("renewal_readiness", { companyName: state.companyName, healthLevel: health.level, reasons: health.reasons });
          return { output: res.data, summary: res.summary, result: res.data };
        }
      );

      if (due.status === "UPCOMING") {
        await emitEvent(ctx, { eventType: "renewal.upcoming", message: `${state.companyName}様の契約更新が${due.daysUntilEnd}日後に迫っています(Health: ${health.level})`, payload: { contractId: contract.id, daysUntilEnd: due.daysUntilEnd, healthLevel: health.level } });
        if (health.level === "RED") {
          await emitEvent(ctx, { eventType: "renewal.at_risk", message: `【要対応】${state.companyName}様は更新リスクが高い状態です: ${health.reasons.join(" / ")}`, payload: { contractId: contract.id, reasons: health.reasons } });
        }
      }

      return { renewalId: renewal.id as string, currentNode: "check_renewal_due" };
    })
    .addNode("detect_upsell", async (state) => {
      const { data: project } = await ctx.supabase.from("projects").select("client_id, contract_id").eq("id", state.projectId).eq("tenant_id", ctx.tenantId).single();
      const clientId = project?.client_id as string | undefined;
      if (!clientId) return { status: "completed" as GraphStatus, currentNode: "detect_upsell" };

      let currentContractServices: string[] = [];
      if (project?.contract_id) {
        const { data: contract } = await ctx.supabase.from("contracts").select("opportunity_id").eq("id", project.contract_id as string).maybeSingle();
        if (contract?.opportunity_id) {
          const { data: opp } = await ctx.supabase.from("opportunities").select("services").eq("id", contract.opportunity_id as string).maybeSingle();
          currentContractServices = ((opp?.services as Array<{ service: string }> | null) ?? []).map((s) => s.service);
        }
      }

      const { data: plans } = await ctx.supabase
        .from("measurement_plans")
        .select("kpi_id, latest_evaluation, status")
        .eq("project_id", state.projectId)
        .eq("tenant_id", ctx.tenantId)
        .in("status", ["COMPLETED"]);

      const { data: existingUpsells } = await ctx.supabase.from("upsell_opportunities").select("client_id, recommended_service, status, cooldown_until, created_at").eq("tenant_id", ctx.tenantId).eq("client_id", clientId);
      const existingRows: ExistingUpsellRow[] = (existingUpsells ?? []).map((u) => ({ clientId: u.client_id as string, recommendedService: u.recommended_service as string, status: u.status as string, cooldownUntil: u.cooldown_until as string | null }));

      const windowStart = new Date(Date.now() - FATIGUE_WINDOW_DAYS * 86_400_000);
      const recentProposalsInWindow = (existingUpsells ?? []).filter((u) => new Date(u.created_at as string).getTime() >= windowStart.getTime()).length;

      const createdIds: string[] = [];
      // Upsell trigger (spec §72, Test Case A): a persistent gap, not just a
      // decline, is grounds for a candidate — PARTIAL_SUCCESS ("still short
      // of target") is exactly the "問題発見" moment the spec's own example
      // describes, not only an outright NEGATIVE result.
      const UPSELL_TRIGGER_EVALUATIONS = new Set(["NEGATIVE", "PARTIAL_SUCCESS"]);
      for (const plan of plans ?? []) {
        const evaluation = plan.latest_evaluation as { evaluation?: string } | null;
        if (!evaluation?.evaluation || !UPSELL_TRIGGER_EVALUATIONS.has(evaluation.evaluation)) continue;

        const { data: kpi } = await ctx.supabase.from("kpis").select("name, direction").eq("id", plan.kpi_id as string).eq("tenant_id", ctx.tenantId).maybeSingle();
        if (!kpi) continue;

        const recommendedService = inferUpsellService(kpi.name as string);
        const candidate = {
          clientId,
          recommendedService,
          problem: `${kpi.name as string}が悪化しています`,
          businessImpact: `${kpi.name as string}の改善は${state.companyName}様のGoal達成に直結します`,
        };

        const dup = checkUpsellDuplicate(candidate, existingRows, new Date());
        if (dup.isDuplicate) {
          await emitEvent(ctx, { eventType: "upsell.skipped", message: `${recommendedService}の提案は重複/Cooldownのためスキップ: ${dup.reason}`, payload: { clientId, recommendedService } });
          continue;
        }

        const critic = criticUpsellCandidate({
          ...candidate,
          currentContractServices,
          recentProposalsInWindow,
          maxProposalsPerPeriod: DEFAULT_MAX_EXPANSION_PROPOSALS_PER_PERIOD,
        });

        const { data: upsellRow, error: upsellError } = await ctx.supabase
          .from("upsell_opportunities")
          .insert({
            tenant_id: ctx.tenantId,
            client_id: clientId,
            project_id: state.projectId,
            source_type: "KPI",
            source_reference_id: plan.kpi_id,
            problem: candidate.problem,
            business_impact: candidate.businessImpact,
            recommended_service: recommendedService,
            confidence: "MEDIUM",
            critic_notes: critic.issues,
            status: critic.passed ? "INTERNAL_REVIEW" : "REJECTED",
            rejected_reason: critic.passed ? null : `Critic自動却下: ${critic.issues.join(" / ")}`,
          })
          .select("id")
          .single();
        if (upsellError || !upsellRow) throw upsellError ?? new Error("Failed to create upsell_opportunity");

        await emitEvent(ctx, {
          eventType: critic.passed ? "upsell.detected" : "upsell.critic_rejected",
          message: critic.passed ? `${recommendedService}のアップセル候補を検出しました` : `アップセル候補をCriticが自動却下: ${critic.issues.join(" / ")}`,
          payload: { upsellOpportunityId: upsellRow.id, recommendedService },
        });

        if (!critic.passed) continue;

        await runAgentStep(
          ctx,
          { agentCode: "upsell", nodeName: "upsell_detection", input: { upsellOpportunityId: upsellRow.id }, projectId: state.projectId },
          async (agent) => {
            const provider = getProviderForAgent(agent);
            const res = await provider.generate("upsell_detection", { companyName: state.companyName, recommendedService, problem: candidate.problem });
            return { output: res.data, summary: res.summary, result: res.data };
          }
        );

        const policies = await loadApprovalPolicies(ctx.supabase, ctx.tenantId);
        const { steps, policyCodes } = computeApprovalSteps(policies, [{ codePrefix: "upsell_opportunity", context: {} }]);
        const approvalId = await createApprovalRequest(ctx, {
          type: "upsell_opportunity",
          subjectType: "upsell_opportunity",
          subjectId: upsellRow.id as string,
          title: `${state.companyName}様への${recommendedService}アップセル提案`,
          description: `${candidate.problem}。${candidate.businessImpact}`,
          aiRecommendation: "KPI悪化に基づく追加提案候補です。Client Goalとの整合性を確認の上、承認をお願いします。",
          requestedByAgentCode: "upsell",
          steps,
          policyCode: policyCodes.join(",") || null,
        });

        await ctx.supabase.from("upsell_opportunities").update({ status: "APPROVAL_PENDING", approval_request_id: approvalId }).eq("id", upsellRow.id as string).eq("tenant_id", ctx.tenantId);
        createdIds.push(upsellRow.id as string);
      }

      return { upsellOpportunityIds: createdIds, status: createdIds.length > 0 ? ("waiting_human" as GraphStatus) : ("completed" as GraphStatus), currentNode: "detect_upsell" };
    })
    .addEdge(START, "check_renewal_due")
    .addEdge("check_renewal_due", "detect_upsell")
    .addEdge("detect_upsell", END)
    .compile({ checkpointer });
}
