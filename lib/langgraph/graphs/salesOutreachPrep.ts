import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, getAgentByCapability, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { recommendChannel, type ChannelRecommendation } from "@/lib/sales/channel";
import { checkOutreachDraft } from "@/lib/sales/outreachCritic";
import { decideCriticVerdict } from "@/lib/sales/criticGate";
import { addLeadCost } from "@/lib/sales/cost";

interface DraftData {
  subject: string;
  opening: string;
  personalizedObservation: string;
  problemHypothesis: string;
  valueProposition: string;
  evidence: Array<{ sourceUrl: string | null; capturedAt: string | null; evidence: string }>;
  cta: string;
  signature: string;
  body: string;
}

const SalesOutreachPrepState = Annotation.Root({
  leadId: lastValue<string>(),
  companyName: lastValue<string | undefined>(),
  industry: lastValue<string | null | undefined>(),
  websiteUrl: lastValue<string | null | undefined>(),
  normalizedDomain: lastValue<string | null | undefined>(),
  testMode: lastValue<boolean>(false),
  observedProblem: lastValue<string | undefined>(),
  whyNow: lastValue<string | undefined>(),
  recommendedServices: lastValue<Array<{ service: string; reason: string }>>([]),
  evidenceSourceUrl: lastValue<string | null | undefined>(),
  evidenceCapturedAt: lastValue<string | null | undefined>(),
  evidenceText: lastValue<string | null | undefined>(),
  channelRec: lastValue<ChannelRecommendation | undefined>(),
  conversationId: lastValue<string | undefined>(),
  messageId: lastValue<string | undefined>(),
  draftData: lastValue<DraftData | undefined>(),
  isDoNotContact: lastValue<boolean>(false),
  isDuplicateRecent: lastValue<boolean>(false),
  criticStatus: lastValue<string | undefined>(),
  criticShouldRetry: lastValue<boolean>(false),
  revisionCount: lastValue<number>(0),
  approvalRequestId: lastValue<string | undefined>(),
  terminalReason: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type SalesOutreachPrepStateType = typeof SalesOutreachPrepState.State;

/**
 * Sales Outreach Workflow (spec §3): READY_FOR_OUTREACH -> Load Lead
 * Research -> Select Channel -> Generate Draft -> Critic -> [revision loop,
 * capped at 3] -> Human Approval. "Create External Draft" and the actual
 * send are deliberately NOT part of this graph — they happen after CEO
 * approval (`applyApproval` for the `sales_send` type) and via the separate
 * Final Send Gate API route, so a human always clicks the literal Send.
 */
export function buildSalesOutreachPrepGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(SalesOutreachPrepState)
    .addNode("load_lead_research", async (state) => {
      const { data: lead, error } = await ctx.supabase
        .from("leads")
        .select("company_name, industry, website, domain, normalized_domain, test_mode")
        .eq("id", state.leadId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !lead) throw error ?? new Error("Lead not found");

      const { data: hypothesis } = await ctx.supabase
        .from("lead_sales_hypotheses")
        .select("observed_problem, why_now, recommended_services")
        .eq("lead_id", state.leadId)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: websiteFinding } = await ctx.supabase
        .from("findings")
        .select("payload, created_at")
        .eq("lead_id", state.leadId)
        .eq("tenant_id", ctx.tenantId)
        .eq("type", "website_diagnosis_lite")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const checks = (websiteFinding?.payload as { checks?: { monthsSinceLastUpdate?: number } } | undefined)?.checks;
      const evidenceText =
        checks?.monthsSinceLastUpdate != null && checks.monthsSinceLastUpdate >= 6
          ? `貴社サイトが${checks.monthsSinceLastUpdate}ヶ月ほど更新されていないようでした`
          : null;

      // Do Not Contact + duplicate-outreach re-check at send-prep time, not
      // only at Discovery time (spec §72 Conflict Prevention).
      const normalizedDomain = (lead.normalized_domain as string | null) ?? null;
      let isDoNotContact = false;
      if (normalizedDomain) {
        const { data: dnc } = await ctx.supabase
          .from("do_not_contact")
          .select("id")
          .eq("tenant_id", ctx.tenantId)
          .eq("normalized_domain", normalizedDomain)
          .maybeSingle();
        isDoNotContact = Boolean(dnc);
      }
      const { data: existingOutbound } = await ctx.supabase
        .from("sales_messages")
        .select("id, status")
        .eq("tenant_id", ctx.tenantId)
        .eq("lead_id", state.leadId)
        .eq("direction", "OUTBOUND");
      const isDuplicateRecent = (existingOutbound ?? []).some((m) => m.status !== "CANCELLED" && m.status !== "FAILED");

      return {
        companyName: lead.company_name as string,
        industry: (lead.industry as string | null) ?? null,
        websiteUrl: (lead.website as string | null) ?? null,
        normalizedDomain,
        testMode: Boolean(lead.test_mode),
        observedProblem: hypothesis?.observed_problem as string | undefined,
        whyNow: hypothesis?.why_now as string | undefined,
        recommendedServices: (hypothesis?.recommended_services as Array<{ service: string; reason: string }> | undefined) ?? [],
        evidenceSourceUrl: evidenceText ? ((lead.website as string | null) ?? null) : null,
        evidenceCapturedAt: websiteFinding?.created_at as string | undefined,
        evidenceText,
        isDoNotContact,
        isDuplicateRecent,
        currentNode: "load_lead_research",
      };
    })
    .addNode("select_channel", async (state) => {
      const agent = await getAgentByCapability(ctx, "channel_selection", "sales");
      const rec = recommendChannel({ normalizedDomain: state.normalizedDomain ?? null, websiteUrl: state.websiteUrl ?? null, testMode: state.testMode });
      await emitEvent(ctx, {
        eventType: "outreach.channel_selected",
        toAgentId: agent.id,
        message: `送信チャネルを選定: ${rec.channel} (${rec.confidence})`,
        payload: { ...rec },
      });
      if (rec.channel !== "EMAIL" || !rec.availableContact) {
        return {
          channelRec: rec,
          terminalReason: rec.risk ?? "有効な連絡先が確認できません",
          status: "completed" as GraphStatus,
          currentNode: "select_channel",
        };
      }
      return { channelRec: rec, currentNode: "select_channel" };
    })
    .addNode("generate_draft", async (state) => {
      const rec = state.channelRec!;
      const draft = await runAgentStep(
        ctx,
        { agentCode: "outreach", nodeName: "generate_draft", input: { leadId: state.leadId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("sales_outreach_email", {
            companyName: state.companyName,
            observedProblem: state.observedProblem,
            recommendedServices: state.recommendedServices,
            whyNow: state.whyNow,
            evidenceSourceUrl: state.evidenceSourceUrl,
            evidenceCapturedAt: state.evidenceCapturedAt,
            evidenceText: state.evidenceText,
          });
          return { output: result.data, summary: result.summary, result: result.data as unknown as DraftData };
        }
      );
      await addLeadCost(ctx, state.leadId, "outreach_draft");

      let conversationId = state.conversationId;
      if (!conversationId) {
        const { data: convRow, error } = await ctx.supabase
          .from("sales_conversations")
          .insert({ tenant_id: ctx.tenantId, lead_id: state.leadId, channel: rec.channel, test_mode: state.testMode })
          .select("id")
          .single();
        if (error || !convRow) throw error ?? new Error("Failed to create sales_conversation");
        conversationId = convRow.id as string;
      }

      const outreachAgent = await getAgentByCapability(ctx, "email_draft", "writer");
      const { data: msgRow, error: msgError } = await ctx.supabase
        .from("sales_messages")
        .insert({
          tenant_id: ctx.tenantId,
          conversation_id: conversationId,
          lead_id: state.leadId,
          direction: "OUTBOUND",
          channel: rec.channel,
          status: "WAITING_REVIEW",
          subject: draft.subject,
          to_address: rec.availableContact,
          opening: draft.opening,
          personalized_observation: draft.personalizedObservation,
          problem_hypothesis: draft.problemHypothesis,
          value_proposition: draft.valueProposition,
          evidence: draft.evidence,
          cta: draft.cta,
          signature: draft.signature,
          body: draft.body,
          created_by_agent_id: outreachAgent.id,
          test_mode: state.testMode,
        })
        .select("id")
        .single();
      if (msgError || !msgRow) throw msgError ?? new Error("Failed to create sales_message");

      return { conversationId, messageId: msgRow.id as string, draftData: draft, currentNode: "generate_draft" };
    })
    .addNode("critic_review", async (state) => {
      const draft = state.draftData!;
      const critic = checkOutreachDraft(
        { subject: draft.subject, personalizedObservation: draft.personalizedObservation, problemHypothesis: draft.problemHypothesis, valueProposition: draft.valueProposition, evidence: draft.evidence, cta: draft.cta, body: draft.body },
        { isDuplicateRecent: state.isDuplicateRecent, isDoNotContact: state.isDoNotContact }
      );
      const decision = decideCriticVerdict(critic.passed, state.revisionCount);
      await addLeadCost(ctx, state.leadId, "critic_review");

      await ctx.supabase
        .from("sales_messages")
        .update({ critic_status: decision.verdict, critic_notes: critic.issues, revision_count: decision.nextRevisionCount, status: decision.verdict === "PASS" ? "WAITING_APPROVAL" : "WAITING_REVIEW" })
        .eq("id", state.messageId)
        .eq("tenant_id", ctx.tenantId);

      const criticAgent = await getAgentByCapability(ctx, "critic_review", "kuro");
      await emitEvent(ctx, {
        eventType: critic.passed ? "critic.reviewed" : "critic.rejected",
        fromAgentId: criticAgent.id,
        message: critic.passed ? "Critic: 営業メールの差し戻し無し" : `Critic: ${critic.issues.join(", ")}`,
        payload: { issues: critic.issues, verdict: decision.verdict, willRetry: decision.shouldRetry },
      });
      if (!critic.passed) {
        await ctx.supabase.from("decision_memories").insert({
          tenant_id: ctx.tenantId,
          category: "sales_outreach_critic",
          note: `Critic差し戻し: ${critic.issues.join(", ")}`,
        });
      }
      if (critic.issues.some((i) => i.startsWith("DNC:"))) {
        return {
          criticStatus: decision.verdict,
          status: "completed" as GraphStatus,
          terminalReason: "Do Not Contactに一致するため送信準備を中止しました",
          currentNode: "critic_review",
        };
      }
      return { criticStatus: decision.verdict, criticShouldRetry: decision.shouldRetry, revisionCount: decision.nextRevisionCount, currentNode: "critic_review" };
    })
    .addNode("request_send_approval", async (state) => {
      const rec = state.channelRec!;
      const draft = state.draftData!;
      const highRisk = state.criticStatus !== "PASS";
      const description = [
        `会社名: ${state.companyName}`,
        `チャネル: ${rec.channel} / 宛先: ${rec.availableContact}`,
        `件名: ${draft.subject}`,
        "",
        draft.body,
      ].join("\n");

      const approvalId = await createApprovalRequest(ctx, {
        type: "sales_send",
        subjectType: "sales_message",
        subjectId: state.messageId!,
        title: `${state.companyName} への営業メール送信承認`,
        description,
        riskLevel: highRisk ? "MEDIUM" : "LOW",
        aiRecommendation: highRisk ? "Criticで指摘事項が残っています。内容の確認を推奨します。" : "Criticレビュー済み。送信承認を推奨します。",
        requestedByAgentCode: "outreach",
      });
      await ctx.supabase.from("sales_messages").update({ approval_request_id: approvalId }).eq("id", state.messageId).eq("tenant_id", ctx.tenantId);

      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "request_send_approval" };
    })
    .addEdge(START, "load_lead_research")
    .addConditionalEdges("load_lead_research", (state) => (state.isDoNotContact ? "blocked" : "continue"), {
      blocked: END,
      continue: "select_channel",
    })
    .addConditionalEdges("select_channel", (state) => (state.status === "completed" ? "stop" : "continue"), {
      stop: END,
      continue: "generate_draft",
    })
    .addEdge("generate_draft", "critic_review")
    .addConditionalEdges("critic_review", (state) => (state.status === "completed" ? "stop" : state.criticShouldRetry ? "retry" : "proceed"), {
      stop: END,
      retry: "generate_draft",
      proceed: "request_send_approval",
    })
    .addEdge("request_send_approval", END)
    .compile({ checkpointer });
}
