import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";
import { addLeadCost } from "@/lib/sales/cost";

const MeetingMinutesState = Annotation.Root({
  meetingId: lastValue<string>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type MeetingMinutesStateType = typeof MeetingMinutesState.State;

/**
 * Meeting Minutes (spec §29-31): draft only, from a transcript already
 * saved on the meeting (`POST /api/meetings/[id]/transcript`). Unknown
 * fields come back as UNASSIGNED/UNSET/UNKNOWN, never a guess (spec §30) —
 * see `TemplateProvider.meetingMinutes`. A human must review before this is
 * used to update the Opportunity (`POST /api/meetings/[id]/minutes/confirm`).
 */
export function buildMeetingMinutesGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(MeetingMinutesState)
    .addNode("generate_minutes", async (state) => {
      const { data: meeting, error } = await ctx.supabase
        .from("meetings")
        .select("lead_id, transcript, opportunity_id")
        .eq("id", state.meetingId)
        .eq("tenant_id", ctx.tenantId)
        .single();
      if (error || !meeting) throw error ?? new Error("Meeting not found");
      if (!meeting.transcript) throw new Error("Meeting has no transcript to summarize");

      const { data: lead } = await ctx.supabase.from("leads").select("company_name").eq("id", meeting.lead_id as string).eq("tenant_id", ctx.tenantId).maybeSingle();
      const companyName = (lead?.company_name as string | undefined) ?? "対象企業";

      const minutes = await runAgentStep(
        ctx,
        { agentCode: "meeting", nodeName: "generate_minutes", input: { meetingId: state.meetingId } },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const result = await provider.generate("meeting_minutes", { transcript: meeting.transcript, companyName });
          return { output: result.data, summary: result.summary, result: result.data };
        }
      );
      if (meeting.lead_id) await addLeadCost(ctx, meeting.lead_id as string, "meeting_minutes");

      await ctx.supabase
        .from("meetings")
        .update({ minutes, minutes_status: "DRAFT", transcript_status: "PROCESSED" })
        .eq("id", state.meetingId)
        .eq("tenant_id", ctx.tenantId);

      await emitEvent(ctx, { eventType: "meeting.minutes_drafted", message: `${companyName}の商談議事録Draftを作成しました（人間の確認が必要です）`, payload: { meetingId: state.meetingId } });

      return { status: "completed" as GraphStatus, currentNode: "generate_minutes" };
    })
    .addEdge(START, "generate_minutes")
    .addEdge("generate_minutes", END)
    .compile({ checkpointer });
}
