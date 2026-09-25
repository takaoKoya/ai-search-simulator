import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, getAgentByCode, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import type { DiscoveredCandidate } from "@/lib/sales/candidateSource";
import { normalizeCompanyName, normalizeDomain } from "@/lib/sales/normalize";
import { checkDuplicate } from "@/lib/sales/duplicates";
import { checkHardExclusion } from "@/lib/sales/exclusion";
import { computeLeadScore, SCORE_VERSION, type ScoreResult } from "@/lib/sales/scoring";
import { decideCriticVerdict } from "@/lib/sales/criticGate";
import { addLeadCost } from "@/lib/sales/cost";

interface IcpConfig {
  id: string;
  target_industries: string[];
  target_regions: string[];
  target_services: string[];
  requires_website: boolean | null;
  exclusion_conditions: string[];
  score_weights: Record<string, number>;
  qualification_thresholds: Record<string, number>;
}

interface HypothesisData {
  observedProblem: string;
  businessImpact: string;
  whyNow: string;
  recommendedServices: Array<{ service: string; reason: string }>;
  expectedOutcome: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidenceCount: number;
  unknowns: string[];
  nextInformationNeeded: string;
  estimatedInitialValue: number;
  estimatedMonthlyValue: number;
  estimatedAnnualValue: number;
  priceRecommendation: Record<string, unknown> | null;
}

const LeadDiscoveryState = Annotation.Root({
  icpProfileId: lastValue<string>(),
  candidate: lastValue<DiscoveredCandidate>(),
  icp: lastValue<IcpConfig | undefined>(),
  leadId: lastValue<string | undefined>(),
  normalizedDomain: lastValue<string | null | undefined>(),
  normalizedCompanyName: lastValue<string | undefined>(),
  duplicateStatus: lastValue<string | undefined>(),
  excluded: lastValue<boolean>(false),
  research: lastValue<{ digitalScore: number | null; weaknesses: string[] } | undefined>(),
  websiteChecks: lastValue<Record<string, unknown> | null | undefined>(),
  growthSignals: lastValue<Array<{ confidence: number }>>([]),
  scoreResult: lastValue<ScoreResult | undefined>(),
  hypothesisId: lastValue<string | undefined>(),
  hypothesisData: lastValue<HypothesisData | undefined>(),
  criticStatus: lastValue<string | undefined>(),
  criticShouldRetry: lastValue<boolean>(false),
  revisionCount: lastValue<number>(0),
  approvalRequestId: lastValue<string | undefined>(),
  terminalReason: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type LeadDiscoveryStateType = typeof LeadDiscoveryState.State;

export function buildLeadDiscoveryGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(LeadDiscoveryState)
    .addNode("load_icp", async (state) => {
      const { data: icp, error } = await ctx.supabase
        .from("icp_profiles")
        .select(
          "id, target_industries, target_regions, target_services, requires_website, exclusion_conditions, score_weights, qualification_thresholds"
        )
        .eq("id", state.icpProfileId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !icp) throw error ?? new Error("ICP profile not found");
      return { icp: icp as unknown as IcpConfig, currentNode: "load_icp" };
    })
    .addNode("generate_search_strategy", async (state) => {
      const strategy = await runAgentStep(
        ctx,
        { agentCode: "scout", nodeName: "generate_search_strategy", input: { icpProfileId: state.icpProfileId } },
        async () => {
          const icp = state.icp!;
          const industries = icp.target_industries.length > 0 ? icp.target_industries.join(" / ") : "業種指定なし";
          const regions = icp.target_regions.length > 0 ? icp.target_regions.join(" / ") : "地域指定なし";
          const data = {
            query: `${industries} × ${regions}`,
            purpose: "ICP条件に合致する候補企業の発見",
            source: state.candidate.sourceType,
            priority: "normal",
            expectedSignal: "Web上の公開情報から成長シグナルを検出",
          };
          return { output: data, summary: `検索戦略を作成: ${data.query}`, result: data };
        }
      );
      await emitEvent(ctx, { eventType: "lead.search_strategy_created", message: `検索戦略を作成: ${strategy.query}`, payload: strategy });
      return { currentNode: "generate_search_strategy" };
    })
    .addNode("candidate_discovery", async (state) => {
      const c = state.candidate;
      await emitEvent(ctx, {
        eventType: "lead.candidate_discovered",
        message: `候補企業を取得: ${c.companyName}${c.testMode ? "（テストデータ）" : ""}`,
        payload: { source: c.sourceType, reason: c.discoveryReason, testMode: c.testMode },
      });
      return { currentNode: "candidate_discovery" };
    })
    .addNode("normalize_and_create_lead", async (state) => {
      const c = state.candidate;
      const normalizedDomain = normalizeDomain(c.domain ?? c.websiteUrl);
      const normalizedCompanyName = normalizeCompanyName(c.companyName);
      const { data: leadRow, error } = await ctx.supabase
        .from("leads")
        .insert({
          tenant_id: ctx.tenantId,
          company_name: c.companyName,
          industry: c.industry,
          website: c.websiteUrl,
          domain: c.domain,
          normalized_company_name: normalizedCompanyName,
          normalized_domain: normalizedDomain,
          region: c.region,
          source: c.sourceName ?? c.sourceType,
          source_type: c.sourceType,
          source_url: c.sourceUrl,
          source_name: c.sourceName,
          status: "new",
          discovery_stage: "DISCOVERED",
          icp_profile_id: state.icpProfileId,
          test_mode: c.testMode,
        })
        .select("id")
        .single();
      if (error || !leadRow) throw error ?? new Error("Failed to create lead");
      await emitEvent(ctx, { eventType: "lead.created", message: `新規Lead「${c.companyName}」を登録`, payload: { leadId: leadRow.id } });
      return {
        leadId: leadRow.id as string,
        normalizedDomain,
        normalizedCompanyName,
        currentNode: "normalize_and_create_lead",
      };
    })
    .addNode("duplicate_and_exclusion_check", async (state) => {
      const dup = await checkDuplicate(ctx.supabase, ctx.tenantId, {
        normalizedDomain: state.normalizedDomain ?? null,
        normalizedCompanyName: state.normalizedCompanyName ?? null,
        excludeLeadId: state.leadId,
      });
      await ctx.supabase.from("leads").update({ duplicate_status: dup.status }).eq("id", state.leadId).eq("tenant_id", ctx.tenantId);

      if (dup.status !== "NEW" && dup.status !== "POSSIBLE_DUPLICATE") {
        await emitEvent(ctx, { eventType: "lead.excluded", message: `重複/対象外のため除外: ${dup.reason}`, payload: { ...dup } });
        await ctx.supabase
          .from("leads")
          .update({ discovery_stage: dup.status === "BLOCKED" ? "BLOCKED" : "ARCHIVED", status: "rejected" })
          .eq("id", state.leadId)
          .eq("tenant_id", ctx.tenantId);
        return {
          duplicateStatus: dup.status,
          excluded: true,
          terminalReason: dup.reason,
          status: "completed" as GraphStatus,
          currentNode: "duplicate_and_exclusion_check",
        };
      }

      const exclusion = checkHardExclusion({ industry: state.candidate.industry, region: state.candidate.region }, state.icp!);
      if (exclusion.excluded) {
        await emitEvent(ctx, { eventType: "lead.excluded", message: `除外条件により除外: ${exclusion.reason}`, payload: { ...exclusion } });
        await ctx.supabase
          .from("leads")
          .update({ discovery_stage: "ARCHIVED", status: "rejected" })
          .eq("id", state.leadId)
          .eq("tenant_id", ctx.tenantId);
        return {
          duplicateStatus: dup.status,
          excluded: true,
          terminalReason: exclusion.reason,
          status: "completed" as GraphStatus,
          currentNode: "duplicate_and_exclusion_check",
        };
      }

      return { duplicateStatus: dup.status, excluded: false, currentNode: "duplicate_and_exclusion_check" };
    })
    .addNode("basic_research", async (state) => {
      await ctx.supabase
        .from("leads")
        .update({ status: "researching", discovery_stage: "RESEARCHING" })
        .eq("id", state.leadId)
        .eq("tenant_id", ctx.tenantId);
      const research = await runAgentStep(
        ctx,
        { agentCode: "research", nodeName: "basic_research", input: { leadId: state.leadId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("company_research", {
            companyName: state.candidate.companyName,
            industry: state.candidate.industry,
          });
          await ctx.supabase.from("findings").insert({
            tenant_id: ctx.tenantId,
            lead_id: state.leadId,
            agent_id: agent.id,
            type: "company_research",
            payload: result.data,
          });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId!, "basic_research");
      await ctx.supabase.from("leads").update({ status: "researched" }).eq("id", state.leadId).eq("tenant_id", ctx.tenantId);
      return {
        research: { digitalScore: (research.digitalScore as number) ?? null, weaknesses: (research.weaknesses as string[]) ?? [] },
        currentNode: "basic_research",
      };
    })
    .addNode("website_check", async (state) => {
      const websiteResult = await runAgentStep(
        ctx,
        { agentCode: "sou", nodeName: "website_check", input: { websiteUrl: state.candidate.websiteUrl } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("website_diagnosis_lite", { websiteUrl: state.candidate.websiteUrl });
          await ctx.supabase.from("findings").insert({
            tenant_id: ctx.tenantId,
            lead_id: state.leadId,
            agent_id: agent.id,
            type: "website_diagnosis_lite",
            payload: result.data,
          });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId!, "website_check");

      const checks = (websiteResult.checks as Record<string, unknown> | null) ?? null;
      const signals: Array<{ signal_type: string; confidence: number; evidence: string }> = [];
      if (checks && typeof checks.monthsSinceLastUpdate === "number" && checks.monthsSinceLastUpdate >= 6) {
        signals.push({
          signal_type: "website_stale",
          confidence: 0.6,
          evidence: `最終更新から${checks.monthsSinceLastUpdate}ヶ月経過と推定`,
        });
      }
      if (state.research?.digitalScore != null && state.research.digitalScore < 40) {
        signals.push({
          signal_type: "low_digital_maturity",
          confidence: 0.5,
          evidence: `デジタル成熟度${state.research.digitalScore}/100`,
        });
      }
      for (const signal of signals) {
        await ctx.supabase.from("findings").insert({
          tenant_id: ctx.tenantId,
          lead_id: state.leadId,
          type: "growth_signal",
          payload: signal,
        });
      }
      if (signals.length > 0) {
        await emitEvent(ctx, { eventType: "lead.growth_signal_detected", message: `成長シグナル${signals.length}件を検出`, payload: { signals } });
      }
      return { websiteChecks: checks, growthSignals: signals.map((s) => ({ confidence: s.confidence })), currentNode: "website_check" };
    })
    .addNode("lead_scoring", async (state) => {
      await ctx.supabase
        .from("leads")
        .update({ status: "scored", discovery_stage: "SCORING" })
        .eq("id", state.leadId)
        .eq("tenant_id", ctx.tenantId);
      const scoreResult = await runAgentStep(
        ctx,
        { agentCode: "scorer", nodeName: "lead_scoring", input: { leadId: state.leadId } },
        async (agent) => {
          const result = computeLeadScore({
            icp: {
              target_industries: state.icp!.target_industries,
              target_regions: state.icp!.target_regions,
              target_services: state.icp!.target_services,
              requires_website: state.icp!.requires_website,
              score_weights: state.icp!.score_weights,
              qualification_thresholds: state.icp!.qualification_thresholds,
            },
            candidate: {
              industry: state.candidate.industry,
              region: state.candidate.region,
              hasWebsite: Boolean(state.candidate.websiteUrl),
              hasContactInfo: Boolean(state.candidate.websiteUrl),
            },
            research: state.research ?? null,
            growthSignals: state.growthSignals,
          });
          await ctx.supabase.from("lead_scores").insert({
            tenant_id: ctx.tenantId,
            lead_id: state.leadId,
            score_version: SCORE_VERSION,
            total: result.total,
            qualification: result.qualification,
            components: result.components,
            created_by_agent_id: agent.id,
          });
          return {
            output: result as unknown as Record<string, unknown>,
            summary: `スコア${result.total}点(${result.qualification})`,
            result,
          };
        }
      );
      await addLeadCost(ctx, state.leadId!, "lead_scoring");
      await ctx.supabase
        .from("leads")
        .update({ score: scoreResult.total, score_version: SCORE_VERSION, qualification: scoreResult.qualification })
        .eq("id", state.leadId)
        .eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, {
        eventType: "lead.scored",
        message: `スコア算定: ${scoreResult.total}点 (${scoreResult.qualification})`,
        payload: { total: scoreResult.total, qualification: scoreResult.qualification },
      });
      if (scoreResult.qualification === "HOT") {
        await emitEvent(ctx, { eventType: "lead.qualified", message: "HOT判定", payload: { qualification: "HOT" } });
      }
      return { scoreResult, currentNode: "lead_scoring" };
    })
    .addNode("archive_low_score", async (state) => {
      const stage = state.scoreResult!.qualification === "NURTURE" ? "ON_HOLD" : "ARCHIVED";
      await ctx.supabase.from("leads").update({ discovery_stage: stage }).eq("id", state.leadId).eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, {
        eventType: "lead.archived",
        message: `スコア${state.scoreResult!.total}点のため${stage === "ON_HOLD" ? "保留(Observe)" : "アーカイブ"}`,
        payload: { qualification: state.scoreResult!.qualification },
      });
      return {
        status: "completed" as GraphStatus,
        terminalReason: `Qualification=${state.scoreResult!.qualification}`,
        currentNode: "archive_low_score",
      };
    })
    .addNode("deep_research", async (state) => {
      await runAgentStep(
        ctx,
        { agentCode: "research", nodeName: "deep_research", input: { leadId: state.leadId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("company_research", {
            companyName: state.candidate.companyName,
            industry: state.candidate.industry,
          });
          await ctx.supabase.from("findings").insert({
            tenant_id: ctx.tenantId,
            lead_id: state.leadId,
            agent_id: agent.id,
            type: "company_research",
            payload: { ...result.data, depth: "deep" },
          });
          return { output: result.data, summary: "深掘り調査を完了", result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId!, "deep_research");
      return { currentNode: "deep_research" };
    })
    .addNode("sales_hypothesis", async (state) => {
      const monthsSinceUpdate = state.websiteChecks?.monthsSinceLastUpdate as number | undefined;
      const hyp = await runAgentStep(
        ctx,
        { agentCode: "sales", nodeName: "sales_hypothesis", input: { leadId: state.leadId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("sales_hypothesis", {
            companyName: state.candidate.companyName,
            weaknesses: state.research?.weaknesses,
            digitalScore: state.research?.digitalScore,
            monthsSinceUpdate,
          });
          return { output: result.data, summary: result.summary, result: result.data as unknown as HypothesisData };
        }
      );
      const { data: hypRow, error } = await ctx.supabase
        .from("lead_sales_hypotheses")
        .insert({
          tenant_id: ctx.tenantId,
          lead_id: state.leadId,
          observed_problem: hyp.observedProblem,
          business_impact: hyp.businessImpact,
          why_now: hyp.whyNow,
          recommended_services: hyp.recommendedServices,
          expected_outcome: hyp.expectedOutcome,
          confidence: hyp.confidence,
          unknowns: hyp.unknowns,
          next_information_needed: hyp.nextInformationNeeded,
          estimated_initial_value: hyp.estimatedInitialValue,
          estimated_monthly_value: hyp.estimatedMonthlyValue,
          estimated_annual_value: hyp.estimatedAnnualValue,
          price_recommendation: hyp.priceRecommendation,
          created_by_agent_id: (await getAgentByCode(ctx, "sales")).id,
        })
        .select("id")
        .single();
      if (error || !hypRow) throw error ?? new Error("Failed to create sales hypothesis");
      await addLeadCost(ctx, state.leadId!, "sales_hypothesis");
      await emitEvent(ctx, { eventType: "sales_hypothesis.created", message: "営業仮説を作成", payload: { hypothesisId: hypRow.id } });
      return { hypothesisId: hypRow.id as string, hypothesisData: hyp, currentNode: "sales_hypothesis" };
    })
    .addNode("critic_review_hypothesis", async (state) => {
      const hyp = state.hypothesisData!;
      const critic = await runAgentStep(
        ctx,
        { agentCode: "kuro", nodeName: "critic_review_hypothesis", input: { hypothesisId: state.hypothesisId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("critic_review", {
            subjectSummary: hyp.observedProblem,
            recommendedServicesCount: hyp.recommendedServices.length,
            confidence: hyp.confidence,
            evidenceCount: hyp.evidenceCount,
            hasPriceNumbers: Boolean(hyp.priceRecommendation),
            hasPriceReason: Boolean((hyp.priceRecommendation as { reason?: string } | null)?.reason),
          });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId!, "critic_review");
      const passed = Boolean(critic.passed);
      const issues = (critic.issues as string[]) ?? [];
      const decision = decideCriticVerdict(passed, state.revisionCount);

      await ctx.supabase
        .from("lead_sales_hypotheses")
        .update({ critic_status: decision.verdict, critic_notes: issues, revision_count: decision.nextRevisionCount })
        .eq("id", state.hypothesisId)
        .eq("tenant_id", ctx.tenantId);

      await emitEvent(ctx, {
        eventType: passed ? "critic.reviewed" : "critic.rejected",
        message: passed ? "Critic: 差し戻し無し" : `Critic: ${issues.join(", ")}`,
        payload: { issues, verdict: decision.verdict, willRetry: decision.shouldRetry },
      });
      if (!passed) {
        await ctx.supabase.from("decision_memories").insert({
          tenant_id: ctx.tenantId,
          category: "sales_hypothesis_critic",
          note: `Critic差し戻し: ${issues.join(", ")}`,
        });
      }
      return {
        criticStatus: decision.verdict,
        criticShouldRetry: decision.shouldRetry,
        revisionCount: decision.nextRevisionCount,
        currentNode: "critic_review_hypothesis",
      };
    })
    .addNode("request_approval", async (state) => {
      const hyp = state.hypothesisData!;
      const score = state.scoreResult!;
      const highRisk = state.criticStatus !== "PASS";
      const description = [
        `会社名: ${state.candidate.companyName}`,
        `業種: ${state.candidate.industry ?? "不明"} / 地域: ${state.candidate.region ?? "不明"}`,
        `Lead Score: ${score.total} (${score.qualification})`,
        `推奨サービス: ${hyp.recommendedServices.map((s) => s.service).join(", ")}`,
        `なぜ今か: ${hyp.whyNow}`,
        `想定初期費用: ¥${hyp.estimatedInitialValue.toLocaleString()}(estimated) / 想定月額: ¥${hyp.estimatedMonthlyValue.toLocaleString()}(estimated)`,
        `Unknowns: ${hyp.unknowns.join(", ") || "なし"}`,
      ].join("\n");

      const approvalId = await createApprovalRequest(ctx, {
        type: "sales_lead",
        subjectType: "lead",
        subjectId: state.leadId!,
        title: `${state.candidate.companyName} を営業候補として承認`,
        description,
        riskLevel: highRisk ? "MEDIUM" : "LOW",
        aiRecommendation: highRisk
          ? "Criticで指摘事項が残っています。内容の確認を推奨します。"
          : "Criticレビュー済み。営業候補としての承認を推奨します。",
        requestedByAgentCode: "sales",
      });
      await ctx.supabase
        .from("leads")
        .update({ discovery_stage: "APPROVAL_PENDING", status: "in_review" })
        .eq("id", state.leadId)
        .eq("tenant_id", ctx.tenantId);
      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "request_approval" };
    })
    .addEdge(START, "load_icp")
    .addEdge("load_icp", "generate_search_strategy")
    .addEdge("generate_search_strategy", "candidate_discovery")
    .addEdge("candidate_discovery", "normalize_and_create_lead")
    .addEdge("normalize_and_create_lead", "duplicate_and_exclusion_check")
    .addConditionalEdges("duplicate_and_exclusion_check", (state) => (state.excluded ? "stop" : "continue"), {
      stop: END,
      continue: "basic_research",
    })
    .addEdge("basic_research", "website_check")
    .addEdge("website_check", "lead_scoring")
    .addConditionalEdges(
      "lead_scoring",
      (state) => (state.scoreResult!.qualification === "HOT" || state.scoreResult!.qualification === "WARM" ? "qualified" : "not_qualified"),
      { qualified: "deep_research", not_qualified: "archive_low_score" }
    )
    .addEdge("archive_low_score", END)
    .addEdge("deep_research", "sales_hypothesis")
    .addEdge("sales_hypothesis", "critic_review_hypothesis")
    .addConditionalEdges("critic_review_hypothesis", (state) => (state.criticShouldRetry ? "retry" : "proceed"), {
      retry: "sales_hypothesis",
      proceed: "request_approval",
    })
    .addEdge("request_approval", END)
    .compile({ checkpointer });
}
