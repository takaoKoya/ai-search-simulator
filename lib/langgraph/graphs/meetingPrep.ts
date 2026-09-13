import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { addLeadCost } from "@/lib/sales/cost";

const MeetingPrepState = Annotation.Root({
  meetingId: lastValue<string>(),
  leadId: lastValue<string | undefined>(),
  companyName: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type MeetingPrepStateType = typeof MeetingPrepState.State;

/**
 * Meeting Prep (spec §26-27): the prep brief (company overview, web issues,
 * growth signals, recommended proposal, questions to ask, risks) is stored
 * as a `findings` row (type='meeting_prep') rather than a new table/column —
 * it is exactly the same shape of artifact as Phase 3's research findings.
 * The draft agenda is a separate concern and lives on `meetings.agenda`.
 */
export function buildMeetingPrepGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(MeetingPrepState)
    .addNode("generate_prep", async (state) => {
      const { data: meeting, error } = await ctx.supabase
        .from("meetings")
        .select("lead_id, opportunity_id")
        .eq("id", state.meetingId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !meeting) throw error ?? new Error("Meeting not found");

      const leadId = (meeting.lead_id as string | null) ?? state.leadId;
      const { data: lead } = await ctx.supabase.from("leads").select("company_name").eq("id", leadId as string).eq("tenant_id", ctx.tenantId).maybeSingle();
      const { data: score } = await ctx.supabase
        .from("lead_scores")
        .select("qualification")
        .eq("lead_id", leadId as string)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: hypothesis } = await ctx.supabase
        .from("lead_sales_hypotheses")
        .select("recommended_services")
        .eq("lead_id", leadId as string)
        .eq("tenant_id", ctx.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: researchFindings } = await ctx.supabase
        .from("findings")
        .select("payload")
        .eq("lead_id", leadId as string)
        .eq("tenant_id", ctx.tenantId)
        .eq("type", "company_research")
        .order("created_at", { ascending: false })
        .limit(1);
      const { data: growthFindings } = await ctx.supabase.from("findings").select("id").eq("lead_id", leadId as string).eq("tenant_id", ctx.tenantId).eq("type", "growth_signal");

      const weaknesses = (researchFindings?.[0]?.payload as { weaknesses?: string[] } | undefined)?.weaknesses ?? [];
      const companyName = (lead?.company_name as string | undefined) ?? "対象企業";

      const prep = await runAgentStep(
        ctx,
        { agentCode: "meeting", nodeName: "generate_prep", input: { meetingId: state.meetingId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("meeting_prep", {
            companyName,
            qualification: score?.qualification ?? "不明",
            weaknesses,
            growthSignalsCount: (growthFindings ?? []).length,
            recommendedServices: (hypothesis?.recommended_services as Array<{ service: string; reason: string }> | undefined) ?? [],
          });
          await ctx.supabase.from("findings").insert({
            tenant_id: ctx.tenantId,
            lead_id: leadId,
            agent_id: agent.id,
            type: "meeting_prep",
            payload: result.data,
          });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      if (leadId) await addLeadCost(ctx, leadId, "meeting_prep");

      await ctx.supabase
        .from("meetings")
        .update({ agenda: prep.agendaDraft ?? [] })
        .eq("id", state.meetingId)
        .eq("tenant_id", ctx.tenantId);

      await emitEvent(ctx, { eventType: "meeting.prep_ready", message: `${companyName}の商談準備資料を作成しました`, payload: { meetingId: state.meetingId } });

      return { companyName, leadId: leadId ?? undefined, status: "completed" as GraphStatus, currentNode: "generate_prep" };
    })
    .addEdge(START, "generate_prep")
    .addEdge("generate_prep", END)
    .compile({ checkpointer });
}
