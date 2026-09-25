import type { SupabaseServerClient } from "@/lib/server/tenant";
import { isBusinessDay, type BusinessCalendar } from "@/lib/server/businessCalendar";
import { buildFollowupDraft, computeFollowupRisk, shouldCreateFollowupCandidate } from "@/lib/sales/followupEngine";

const MIN_BUSINESS_DAYS_BEFORE_FOLLOWUP = 3;
const MAX_FOLLOWUPS_PER_MESSAGE = 2;

function countBusinessDaysBetween(start: Date, end: Date, calendar: BusinessCalendar): number {
  let count = 0;
  const cursor = new Date(start);
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getTime() <= end.getTime() && isBusinessDay(cursor, calendar)) count += 1;
  }
  return count;
}

/**
 * Scans one tenant's SENT outbound sales_messages for ones that have gone
 * unanswered long enough to warrant a Follow-up Candidate (spec §67-71).
 * Never sends anything — every row this creates is status='CANDIDATE',
 * requiring the same Human Approval + Final Send Gate path as any other
 * outbound email (see lib/server/salesSendGate.ts, sales-messages send
 * route). Designed to be called once per tenant from a scheduled job
 * (lib/server/backgroundJob.ts), but is plain, tenant-scoped, testable
 * async code with no scheduling logic of its own.
 */
export async function checkFollowupsForTenant(supabase: SupabaseServerClient, tenantId: string, calendar: BusinessCalendar, now: Date = new Date()): Promise<{ created: number }> {
  const { data: outboundMessages, error } = await supabase
    .from("sales_messages")
    .select("id, conversation_id, lead_id, subject, recipient_name, sent_at, status")
    .eq("tenant_id", tenantId)
    .eq("direction", "OUTBOUND")
    .eq("status", "SENT");
  if (error) throw error;

  let created = 0;
  for (const message of outboundMessages ?? []) {
    if (!message.sent_at) continue;
    const sentAt = new Date(message.sent_at as string);
    const businessDaysElapsed = countBusinessDaysBetween(sentAt, now, calendar);

    const { data: conversationMessages, error: conversationError } = await supabase
      .from("sales_messages")
      .select("id, direction, created_at")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", message.conversation_id as string);
    if (conversationError) throw conversationError;
    const hasReply = (conversationMessages ?? []).some((m) => m.direction === "INBOUND" && new Date(m.created_at as string).getTime() > sentAt.getTime());
    if (hasReply) continue;

    const { data: existingCandidates, error: candidatesError } = await supabase
      .from("followup_candidates")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("original_message_id", message.id as string);
    if (candidatesError) throw candidatesError;
    const existingCount = (existingCandidates ?? []).length;

    if (
      !shouldCreateFollowupCandidate({
        messageStatus: message.status as string,
        businessDaysElapsed,
        minBusinessDaysBeforeFollowup: MIN_BUSINESS_DAYS_BEFORE_FOLLOWUP,
        existingCandidateCount: existingCount,
        maxFollowups: MAX_FOLLOWUPS_PER_MESSAGE,
      })
    ) {
      continue;
    }

    const { data: lead } = await supabase.from("leads").select("company_name").eq("id", message.lead_id as string).eq("tenant_id", tenantId).maybeSingle();
    const draft = buildFollowupDraft({
      companyName: (lead?.company_name as string | undefined) ?? "対象企業",
      recipientName: (message.recipient_name as string | null) ?? null,
      originalSubject: (message.subject as string | null) ?? "",
      sequenceNumber: existingCount + 1,
    });

    const { error: insertError } = await supabase.from("followup_candidates").insert({
      tenant_id: tenantId,
      lead_id: message.lead_id,
      original_message_id: message.id,
      sequence_number: existingCount + 1,
      reason: `送信から${businessDaysElapsed}営業日、返信がありません`,
      business_days_elapsed: businessDaysElapsed,
      draft_subject: draft.subject,
      draft_body: draft.body,
      risk: computeFollowupRisk(businessDaysElapsed),
      status: "CANDIDATE",
    });
    if (insertError) throw insertError;
    created += 1;
  }

  return { created };
}
