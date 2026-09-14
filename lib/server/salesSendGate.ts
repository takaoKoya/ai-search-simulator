import type { TenantContext } from "@/lib/server/tenant";
import { checkSnapshot, type SnapshotInvalidReason } from "@/lib/server/approvalSnapshot";
import { isDoNotContact } from "@/lib/sales/dnc";

export interface SendGateMessage {
  to_address: string | null;
  subject: string | null;
  body: string | null;
  lead_id: string | null;
  approval_request_id: string | null;
}

export type SendGateFailureReason = SnapshotInvalidReason | "DO_NOT_CONTACT";

export interface SendGateCheckResult {
  ok: boolean;
  reason?: SendGateFailureReason;
}

/**
 * The Final Send Gate's re-verification (spec §45): approval still valid
 * (not expired), recipient/subject/body unchanged since approval (Approval
 * Snapshot Hash), and the lead has not become Do Not Contact since approval
 * was granted. Extracted as a pure-ish, DB-reading function (no writes) so
 * the send route's precondition logic is unit-testable without a live
 * Next.js request — the route is responsible for acting on the result
 * (blocking the send, marking the message APPROVAL_INVALIDATED).
 */
export async function verifySendPreconditions(ctx: TenantContext, message: SendGateMessage): Promise<SendGateCheckResult> {
  const { supabase, tenantId } = ctx;

  if (message.approval_request_id) {
    const { data: approval } = await supabase
      .from("approval_requests")
      .select("snapshot_hash, expires_at")
      .eq("id", message.approval_request_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const snapshotResult = checkSnapshot({
      snapshotHash: (approval?.snapshot_hash as string | null) ?? null,
      expiresAt: (approval?.expires_at as string | null) ?? null,
      currentFields: { to: message.to_address, subject: message.subject, body: message.body },
    });
    if (!snapshotResult.valid) return { ok: false, reason: snapshotResult.reason };
  }

  if (message.lead_id) {
    const { data: lead } = await supabase.from("leads").select("company_name, domain").eq("id", message.lead_id).eq("tenant_id", tenantId).maybeSingle();
    if (lead && (await isDoNotContact(supabase, tenantId, { companyName: lead.company_name as string, domain: (lead.domain as string | null) ?? null }))) {
      return { ok: false, reason: "DO_NOT_CONTACT" };
    }
  }

  return { ok: true };
}
