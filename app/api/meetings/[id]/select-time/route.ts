import type { NextRequest } from "next/server";
import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { getCalendarConnector } from "@/lib/sales/calendarConnector";

/**
 * Calendar Approval (spec §23-24): confirming a meeting date/time is on the
 * spec's explicit Human Approval list (§0 "商談日時確定"). This route is
 * gated the same way `decideApproval` is (owner/ceo/admin only) even though
 * it does not go through the shared `approval_requests` table — selecting
 * one of several AI-proposed options is a plain choice, not an
 * approve/reject/revise decision.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);
    const { supabase, tenantId, userId } = ctx;

    const body = await request.json().catch(() => ({}));
    const start = typeof body.start === "string" ? body.start : null;
    const end = typeof body.end === "string" ? body.end : null;
    if (!start || !end) throw new ValidationError("start and end are required");

    const { data: meeting, error } = await supabase
      .from("meetings")
      .select("id, title, status, candidate_times, participants")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!meeting) throw new NotFoundError("Meeting not found");
    if (meeting.status === "SCHEDULED") throw new ValidationError("Meeting is already scheduled");

    const candidates = (meeting.candidate_times as Array<{ start: string; end: string }>) ?? [];
    const chosen = candidates.find((c) => c.start === start && c.end === end);
    if (!chosen) throw new ValidationError("Selected time is not one of the proposed candidates");

    const connector = getCalendarConnector();
    const attendees = ((meeting.participants as Array<{ email?: string }>) ?? []).map((p) => p.email).filter((e): e is string => Boolean(e));
    const event = await connector.createEvent({ title: meeting.title as string, start, end, attendees });

    const durationMinutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    await supabase
      .from("meetings")
      .update({
        status: "SCHEDULED",
        scheduled_at: start,
        duration_minutes: durationMinutes,
        meeting_url: event.meetingUrl,
        calendar_event_id: event.eventId,
        calendar_provider: event.provider,
      })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    await supabase.from("external_action_logs").insert({
      tenant_id: tenantId,
      action_type: "CALENDAR_CREATE",
      subject_type: "meeting",
      subject_id: id,
      performed_by_user_id: userId,
      provider: event.provider,
      provider_ref: event.eventId,
      status: "SUCCESS",
      payload: { title: meeting.title, start, end },
    });

    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "meeting.scheduled",
      message: `${meeting.title}の日時が確定しました`,
      payload: { meetingId: id, start, end },
    });

    return { scheduled: true, calendarEventId: event.eventId, meetingUrl: event.meetingUrl };
  });
}
