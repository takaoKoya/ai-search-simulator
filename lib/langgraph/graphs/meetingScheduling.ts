import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, getAgentByCapability, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getCalendarConnector, type CalendarSlot } from "@/lib/sales/calendarConnector";

const MeetingSchedulingState = Annotation.Root({
  opportunityId: lastValue<string>(),
  companyName: lastValue<string | undefined>(),
  meetingId: lastValue<string | undefined>(),
  candidateTimes: lastValue<CalendarSlot[]>([]),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type MeetingSchedulingStateType = typeof MeetingSchedulingState.State;

/**
 * Meeting Scheduling (spec §22-23): AI proposes candidate slots via the
 * simulated calendar connector; it never confirms one itself. Confirming a
 * slot and actually creating the calendar event is a separate human action
 * (`POST /api/meetings/[id]/select-time`), consistent with the brief's
 * "AIが候補を提示。ただし、勝手に確定しない" instruction.
 */
export function buildMeetingSchedulingGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(MeetingSchedulingState)
    .addNode("propose_times", async (state) => {
      const agent = await getAgentByCapability(ctx, "meeting_scheduling", "meeting");
      const connector = await getCalendarConnector();
      const slots = connector.proposeSlots(state.opportunityId, 3, 45);

      const { data: oppRow } = await ctx.supabase.from("opportunities").select("lead_id").eq("id", state.opportunityId).eq("tenant_id", ctx.tenantId).maybeSingle();

      const { data: meetingRow, error } = await ctx.supabase
        .from("meetings")
        .insert({
          tenant_id: ctx.tenantId,
          lead_id: oppRow?.lead_id ?? null,
          opportunity_id: state.opportunityId,
          title: `${state.companyName ?? "対象企業"} 商談`,
          meeting_type: "discovery",
          status: "SCHEDULING",
          candidate_times: slots,
        })
        .select("id")
        .single();
      if (error || !meetingRow) throw error ?? new Error("Failed to create meeting");

      await emitEvent(ctx, {
        toAgentId: agent.id,
        eventType: "meeting.times_proposed",
        message: `${state.companyName ?? "対象企業"}向けに商談候補日時を${slots.length}件提示しました`,
        payload: { meetingId: meetingRow.id, candidateTimes: slots },
      });

      return { meetingId: meetingRow.id as string, candidateTimes: slots, status: "completed" as GraphStatus, currentNode: "propose_times" };
    })
    .addEdge(START, "propose_times")
    .addEdge("propose_times", END)
    .compile({ checkpointer });
}
