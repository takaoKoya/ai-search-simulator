import type { NextRequest } from "next/server";
import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";

const VALID_REASONS = ["competitor", "price_issue", "timing", "no_budget", "no_need", "internal_issue", "unknown", "other"];

/**
 * Marks an Opportunity LOST (spec §57) — a plain, human-recorded outcome,
 * not an AI-authored decision to approve/reject, so it does not go through
 * `approval_requests`. The reason is fed into `decision_memories` for
 * Decision Learning (spec §58) exactly like a sales_lead rejection is.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);
    const { supabase, tenantId, userId } = ctx;
    const body = await request.json().catch(() => ({}));
    const lostReason = typeof body.lostReason === "string" ? body.lostReason : "unknown";
    const lostDetail = typeof body.lostDetail === "string" ? body.lostDetail : null;
    if (!VALID_REASONS.includes(lostReason)) throw new ValidationError(`lostReason must be one of: ${VALID_REASONS.join(", ")}`);

    const { data: opp, error } = await supabase.from("opportunities").select("id, lead_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!opp) throw new NotFoundError("Opportunity not found");

    await supabase.from("opportunities").update({ stage: "LOST", status: "lost", lost_reason: lostReason, lost_detail: lostDetail }).eq("id", id).eq("tenant_id", tenantId);
    await supabase.from("leads").update({ status: "lost" }).eq("id", opp.lead_id as string).eq("tenant_id", tenantId);

    await supabase.from("decision_memories").insert({
      tenant_id: tenantId,
      category: "opportunity_lost",
      note: lostDetail && lostDetail.trim().length > 0 ? lostDetail.trim() : `失注理由: ${lostReason}`,
      created_by_user_id: userId,
    });

    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "opportunity.lost",
      message: `商談が失注になりました（理由: ${lostReason}）`,
      payload: { opportunityId: id, lostReason, lostDetail },
    });

    return { ok: true };
  });
}
