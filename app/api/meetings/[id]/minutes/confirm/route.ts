import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";

const UNKNOWN_VALUES = new Set(["UNKNOWN", "UNASSIGNED", "UNSET"]);

/**
 * Human review of the Minutes Draft (spec §29 "Human Review"). The human
 * may edit any field and confirm/add Action Items before this counts as
 * reviewed. Only non-placeholder fields (not UNKNOWN/UNASSIGNED/UNSET) flow
 * into the Opportunity's qualification fields — a field the AI honestly
 * could not determine from the transcript never overwrites real data with a
 * guess (spec §30).
 *
 * Action Items stay as reviewed structured data on the meeting itself
 * rather than becoming real `tasks` rows: `tasks.project_id` is NOT NULL
 * and no project exists until WON -> Contract -> Onboarding (see README
 * known limitations).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));

    const { data: meeting, error } = await supabase
      .from("meetings")
      .select("id, opportunity_id, minutes, minutes_status")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!meeting) throw new NotFoundError("Meeting not found");
    if (!meeting.minutes) throw new ValidationError("No minutes draft exists yet for this meeting");

    const existingMinutes = meeting.minutes as Record<string, unknown>;
    const editedMinutes = (body.minutes as Record<string, unknown> | undefined) ?? {};
    const actionItems = Array.isArray(body.actionItems) ? body.actionItems : (existingMinutes.actionItems ?? []);
    const mergedMinutes: Record<string, unknown> = { ...existingMinutes, ...editedMinutes, actionItems };

    await supabase.from("meetings").update({ minutes: mergedMinutes, minutes_status: "HUMAN_REVIEWED" }).eq("id", id).eq("tenant_id", tenantId);

    if (meeting.opportunity_id) {
      const qualificationUpdate: Record<string, unknown> = { stage: "NEEDS_ANALYSIS", qualification: mergedMinutes };
      const budget = mergedMinutes.budget as string | undefined;
      const authority = mergedMinutes.authority as string | undefined;
      const timing = mergedMinutes.timing as string | undefined;
      const clientNeeds = mergedMinutes.clientNeeds as string | undefined;
      if (budget && !UNKNOWN_VALUES.has(budget)) qualificationUpdate.budget = budget;
      if (authority && !UNKNOWN_VALUES.has(authority)) qualificationUpdate.decision_maker = authority;
      if (timing && !UNKNOWN_VALUES.has(timing)) qualificationUpdate.timeline = timing;
      if (clientNeeds && !UNKNOWN_VALUES.has(clientNeeds)) qualificationUpdate.need = clientNeeds;

      await supabase.from("opportunities").update(qualificationUpdate).eq("id", meeting.opportunity_id as string).eq("tenant_id", tenantId);
      await supabase.from("meetings").update({ status: "COMPLETED" }).eq("id", id).eq("tenant_id", tenantId);
      await supabase.from("agent_events").insert({
        tenant_id: tenantId,
        event_type: "meeting.minutes_reviewed",
        message: "商談議事録を人間が確認し、Opportunity情報を更新しました",
        payload: { meetingId: id, opportunityId: meeting.opportunity_id },
      });
    }

    return { ok: true };
  });
}
