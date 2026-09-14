import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { getEmailConnector } from "@/lib/sales/emailConnector";

/**
 * Final Send Gate (spec §11-12): the one place an email actually leaves the
 * building. Deliberately a separate, human-only action from the `sales_send`
 * / `sales_reply` approval that came before it — approving content is not
 * the same operation as clicking Send.
 *
 * Double-send safety (spec §12, §73): the status transition
 * READY_TO_SEND -> SENT is a single conditional UPDATE (`... where
 * status = 'READY_TO_SEND'`), so under a race only one concurrent request
 * can win it; a second request (or a second click) sees the row already
 * SENT and returns the original result instead of sending twice.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);
    const { supabase, tenantId, userId } = ctx;

    const { data: message, error } = await supabase
      .from("sales_messages")
      .select("id, status, to_address, subject, body, lead_id, opportunity_id, channel, test_mode, provider, provider_message_id, provider_thread_id, sent_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!message) throw new NotFoundError("Message not found");

    if (message.status === "SENT") {
      // Idempotent no-op: report the original send result rather than erroring.
      return { alreadySent: true, providerMessageId: message.provider_message_id, sentAt: message.sent_at };
    }
    if (message.status !== "READY_TO_SEND") {
      throw new ValidationError(`Message is not ready to send (status=${message.status}). It must be CEO-approved first.`);
    }
    if (!message.to_address) {
      throw new ValidationError("Message has no destination address");
    }

    const connector = await getEmailConnector({ supabase, tenantId, userId });
    const idempotencyKey = `send-${message.id}`;
    const sendResult = await connector.send({ to: message.to_address as string, subject: message.subject as string, body: message.body as string }, idempotencyKey);

    // Atomic compare-and-swap: only a request that actually observes
    // status='READY_TO_SEND' at update time can win this write.
    const { data: updated, error: updateError } = await supabase
      .from("sales_messages")
      .update({
        status: "SENT",
        sent_at: sendResult.sentAt,
        provider: sendResult.provider,
        provider_message_id: sendResult.providerMessageId,
        provider_thread_id: sendResult.providerThreadId,
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "READY_TO_SEND")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;

    if (!updated) {
      // Lost the race to a concurrent send — report the (now current) result.
      const { data: current } = await supabase
        .from("sales_messages")
        .select("provider_message_id, sent_at, status")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return { alreadySent: current?.status === "SENT", providerMessageId: current?.provider_message_id ?? null, sentAt: current?.sent_at ?? null };
    }

    await supabase.from("external_action_logs").insert({
      tenant_id: tenantId,
      action_type: "EMAIL_SEND",
      subject_type: "sales_message",
      subject_id: id,
      performed_by_user_id: userId,
      provider: sendResult.provider,
      provider_ref: sendResult.providerMessageId,
      idempotency_key: idempotencyKey,
      status: "SUCCESS",
      payload: { to: message.to_address, subject: message.subject, channel: message.channel },
      test_mode: Boolean(message.test_mode),
    });

    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "sales_message.sent",
      message: `営業メールを送信しました（${message.to_address}）`,
      payload: { messageId: id, provider: sendResult.provider },
    });

    // Only the first outbound touch on a lead advances DISCOVERY_STAGE to
    // CONTACTED — a later reply send must never regress a lead that has
    // already moved further along the pipeline.
    if (message.lead_id) {
      await supabase
        .from("leads")
        .update({ discovery_stage: "CONTACTED", status: "contacted" })
        .eq("id", message.lead_id as string)
        .eq("tenant_id", tenantId)
        .eq("discovery_stage", "READY_FOR_OUTREACH");
    }

    return { sent: true, providerMessageId: sendResult.providerMessageId, providerThreadId: sendResult.providerThreadId, sentAt: sendResult.sentAt };
  });
}
