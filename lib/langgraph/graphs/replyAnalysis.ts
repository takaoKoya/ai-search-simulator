import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, getAgentByCapability, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { checkReplyDraft } from "@/lib/sales/outreachCritic";
import { decideCriticVerdict } from "@/lib/sales/criticGate";
import { addLeadCost } from "@/lib/sales/cost";

const MEETING_SIGNAL_CLASSES = new Set(["MEETING_REQUEST", "INTERESTED", "POSITIVE", "PRICE_QUESTION"]);
const SKIP_DRAFT_CLASSES = new Set(["AUTO_REPLY", "BOUNCE"]);

const PRIORITY_BY_CLASS: Record<string, "P0" | "P1" | "P2"> = {
  DO_NOT_CONTACT: "P0",
  MEETING_REQUEST: "P0",
  INTERESTED: "P1",
  PRICE_QUESTION: "P1",
  POSITIVE: "P1",
  QUESTION: "P1",
  REFERRAL: "P1",
  NOT_NOW: "P2",
  NOT_INTERESTED: "P2",
  AUTO_REPLY: "P2",
  BOUNCE: "P2",
  UNKNOWN: "P2",
};

const ReplyAnalysisState = Annotation.Root({
  originalMessageId: lastValue<string>(),
  replyText: lastValue<string>(),
  leadId: lastValue<string | undefined>(),
  opportunityId: lastValue<string | null | undefined>(),
  conversationId: lastValue<string | undefined>(),
  channel: lastValue<string | undefined>(),
  companyName: lastValue<string | undefined>(),
  recommendedServices: lastValue<Array<{ service: string; reason: string }>>([]),
  inboundMessageId: lastValue<string | undefined>(),
  classification: lastValue<string | undefined>(),
  confidence: lastValue<number | undefined>(),
  priority: lastValue<"P0" | "P1" | "P2" | undefined>(),
  isDoNotContact: lastValue<boolean>(false),
  replyDraftMessageId: lastValue<string | undefined>(),
  draftBody: lastValue<string | null | undefined>(),
  criticStatus: lastValue<string | undefined>(),
  criticShouldRetry: lastValue<boolean>(false),
  revisionCount: lastValue<number>(0),
  approvalRequestId: lastValue<string | undefined>(),
  terminalReason: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type ReplyAnalysisStateType = typeof ReplyAnalysisState.State;

/**
 * Reply Monitoring / Classification / Reply Draft (spec §15-21). Runs once
 * per inbound reply (in this sandbox: a test-mode reply the human pastes
 * in — see `/api/sales-messages/[id]/simulate-reply`, since there is no
 * real Gmail inbox to poll). Never drafts a reply to a DO_NOT_CONTACT
 * classification (spec §18) and never sends anything — the resulting reply
 * draft still goes through a `sales_reply` CEO approval + the same Final
 * Send Gate as first-touch outreach.
 */
export function buildReplyAnalysisGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(ReplyAnalysisState)
    .addNode("record_inbound", async (state) => {
      const { data: original, error } = await ctx.supabase
        .from("sales_messages")
        .select("id, conversation_id, lead_id, opportunity_id, channel, provider_message_id, test_mode")
        .eq("id", state.originalMessageId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !original) throw error ?? new Error("Original message not found");

      const { data: lead } = await ctx.supabase.from("leads").select("company_name").eq("id", original.lead_id as string).eq("tenant_id", ctx.tenantId).maybeSingle();
      const { data: hypothesis } = await ctx.supabase
        .from("lead_sales_hypotheses")
        .select("recommended_services")
        .eq("lead_id", original.lead_id as string)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: inboundRow, error: inboundError } = await ctx.supabase
        .from("sales_messages")
        .insert({
          tenant_id: ctx.tenantId,
          conversation_id: original.conversation_id,
          lead_id: original.lead_id,
          opportunity_id: original.opportunity_id,
          direction: "INBOUND",
          channel: original.channel,
          status: "DELIVERED",
          body: state.replyText,
          in_reply_to: (original.provider_message_id as string | null) ?? original.id,
          test_mode: Boolean(original.test_mode),
        })
        .select("id")
        .single();
      if (inboundError || !inboundRow) throw inboundError ?? new Error("Failed to record inbound reply");

      await ctx.supabase.from("sales_messages").update({ status: "REPLIED" }).eq("id", original.id as string).eq("tenant_id", ctx.tenantId);

      return {
        leadId: original.lead_id as string,
        opportunityId: (original.opportunity_id as string | null) ?? null,
        conversationId: original.conversation_id as string,
        channel: original.channel as string,
        companyName: (lead?.company_name as string | undefined) ?? "対象企業",
        recommendedServices: (hypothesis?.recommended_services as Array<{ service: string; reason: string }> | undefined) ?? [],
        inboundMessageId: inboundRow.id as string,
        currentNode: "record_inbound",
      };
    })
    .addNode("classify_reply", async (state) => {
      const classification = await runAgentStep(
        ctx,
        { agentCode: "analyst", nodeName: "classify_reply", input: { messageId: state.inboundMessageId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("reply_classification", { replyText: state.replyText });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId!, "reply_classification");
      const cls = String(classification.classification);
      const confidence = Number(classification.confidence);
      const priority = PRIORITY_BY_CLASS[cls] ?? "P2";

      await ctx.supabase
        .from("sales_messages")
        .update({ reply_classification: cls, reply_confidence: confidence, reply_priority: priority })
        .eq("id", state.inboundMessageId)
        .eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, {
        eventType: "lead.reply_received",
        message: `${state.companyName}から返信を受信: ${cls} (優先度${priority})`,
        payload: { classification: cls, confidence, priority },
      });
      if (cls !== "AUTO_REPLY" && cls !== "BOUNCE") {
        await ctx.supabase.from("leads").update({ discovery_stage: "RESPONDED" }).eq("id", state.leadId).eq("tenant_id", ctx.tenantId).eq("discovery_stage", "CONTACTED");
      }
      if (cls === "BOUNCE") {
        await ctx.supabase.from("sales_messages").update({ status: "BOUNCED" }).eq("id", state.originalMessageId).eq("tenant_id", ctx.tenantId);
      }

      return { classification: cls, confidence, priority, isDoNotContact: cls === "DO_NOT_CONTACT", currentNode: "classify_reply" };
    })
    .addNode("flag_do_not_contact", async (state) => {
      const approvalId = await createApprovalRequest(ctx, {
        type: "sales_reply",
        subjectType: "sales_message",
        subjectId: state.inboundMessageId!,
        title: `${state.companyName} が今後の連絡を希望していません`,
        description: state.replyText,
        riskLevel: "HIGH",
        aiRecommendation: "「Do Not Contact」を選択して今後の営業対象から除外してください。AIはこの企業へ返信を作成していません（spec §18）。",
        requestedByAgentCode: "analyst",
      });
      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "flag_do_not_contact" };
    })
    .addNode("log_only", async (state) => {
      await emitEvent(ctx, {
        eventType: "lead.reply_logged",
        message: `${state.companyName}からの返信は${state.classification}のため返信案の作成をスキップしました`,
      });
      return { status: "completed" as GraphStatus, terminalReason: `classification=${state.classification}`, currentNode: "log_only" };
    })
    .addNode("check_meeting_conversion", async (state) => {
      if (!MEETING_SIGNAL_CLASSES.has(state.classification ?? "")) {
        return { currentNode: "check_meeting_conversion" };
      }
      if (state.opportunityId) {
        return { currentNode: "check_meeting_conversion" };
      }
      const { data: hypothesis } = await ctx.supabase
        .from("lead_sales_hypotheses")
        .select("estimated_initial_value")
        .eq("lead_id", state.leadId)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: oppRow, error } = await ctx.supabase
        .from("opportunities")
        .insert({
          tenant_id: ctx.tenantId,
          lead_id: state.leadId,
          stage: "MEETING",
          probability: 25,
          estimated_value: (hypothesis?.estimated_initial_value as number | null) ?? null,
          services: state.recommendedServices,
          status: "open",
        })
        .select("id")
        .single();
      if (error || !oppRow) throw error ?? new Error("Failed to create opportunity");

      await ctx.supabase.from("sales_messages").update({ opportunity_id: oppRow.id }).eq("conversation_id", state.conversationId).eq("tenant_id", ctx.tenantId);
      await ctx.supabase.from("sales_conversations").update({ opportunity_id: oppRow.id }).eq("id", state.conversationId).eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, {
        eventType: "opportunity.stage_changed",
        message: `${state.companyName}が商談化しました（Meeting Conversion）`,
        payload: { opportunityId: oppRow.id, from: null, to: "MEETING" },
      });

      return { opportunityId: oppRow.id as string, currentNode: "check_meeting_conversion" };
    })
    .addNode("generate_reply_draft", async (state) => {
      const reply = await runAgentStep(
        ctx,
        { agentCode: "analyst", nodeName: "generate_reply_draft", input: { messageId: state.inboundMessageId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("reply_draft", {
            companyName: state.companyName,
            classification: state.classification,
            replyText: state.replyText,
            recommendedServices: state.recommendedServices,
          });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      await addLeadCost(ctx, state.leadId!, "reply_draft");

      const draftBody = (reply.draftBody as string | null) ?? null;
      const draftSubject = (reply.draftSubject as string | undefined) ?? `Re: ${state.companyName}様よりのご返信`;

      const analystAgent = await getAgentByCapability(ctx, "reply_draft", "analyst");
      const { data: original } = await ctx.supabase.from("sales_messages").select("to_address").eq("id", state.originalMessageId).eq("tenant_id", ctx.tenantId).maybeSingle();
      const { data: msgRow, error } = await ctx.supabase
        .from("sales_messages")
        .insert({
          tenant_id: ctx.tenantId,
          conversation_id: state.conversationId,
          lead_id: state.leadId,
          opportunity_id: state.opportunityId,
          direction: "OUTBOUND",
          channel: state.channel,
          status: "WAITING_REVIEW",
          subject: draftSubject,
          to_address: original?.to_address ?? null,
          body: draftBody,
          in_reply_to: state.inboundMessageId,
          created_by_agent_id: analystAgent.id,
        })
        .select("id")
        .single();
      if (error || !msgRow) throw error ?? new Error("Failed to create reply draft message");

      return { replyDraftMessageId: msgRow.id as string, draftBody, currentNode: "generate_reply_draft" };
    })
    .addNode("critic_review", async (state) => {
      const critic = checkReplyDraft(state.draftBody ?? "", { isDoNotContact: state.isDoNotContact });
      const decision = decideCriticVerdict(critic.passed, state.revisionCount);
      await addLeadCost(ctx, state.leadId!, "critic_review");

      await ctx.supabase
        .from("sales_messages")
        .update({ critic_status: decision.verdict, critic_notes: critic.issues, revision_count: decision.nextRevisionCount, status: decision.verdict === "PASS" ? "WAITING_APPROVAL" : "WAITING_REVIEW" })
        .eq("id", state.replyDraftMessageId)
        .eq("tenant_id", ctx.tenantId);

      return { criticStatus: decision.verdict, criticShouldRetry: decision.shouldRetry, revisionCount: decision.nextRevisionCount, currentNode: "critic_review" };
    })
    .addNode("request_reply_approval", async (state) => {
      const approvalId = await createApprovalRequest(ctx, {
        type: "sales_reply",
        subjectType: "sales_message",
        subjectId: state.replyDraftMessageId!,
        title: `${state.companyName} への返信承認`,
        description: state.draftBody ?? "",
        riskLevel: state.criticStatus === "PASS" ? "LOW" : "MEDIUM",
        aiRecommendation: state.criticStatus === "PASS" ? "Criticレビュー済み。送信承認を推奨します。" : "Criticで指摘事項が残っています。",
        requestedByAgentCode: "analyst",
      });
      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "request_reply_approval" };
    })
    .addEdge(START, "record_inbound")
    .addEdge("record_inbound", "classify_reply")
    .addConditionalEdges(
      "classify_reply",
      (state) => (state.isDoNotContact ? "dnc" : SKIP_DRAFT_CLASSES.has(state.classification ?? "") ? "skip" : "continue"),
      { dnc: "flag_do_not_contact", skip: "log_only", continue: "check_meeting_conversion" }
    )
    .addEdge("flag_do_not_contact", END)
    .addEdge("log_only", END)
    .addEdge("check_meeting_conversion", "generate_reply_draft")
    .addEdge("generate_reply_draft", "critic_review")
    .addConditionalEdges("critic_review", (state) => (state.criticShouldRetry ? "retry" : "proceed"), {
      retry: "generate_reply_draft",
      proceed: "request_reply_approval",
    })
    .addEdge("request_reply_approval", END)
    .compile({ checkpointer });
}
