import type { NextRequest } from "next/server";
import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { reconcileProposalAndEstimate } from "@/lib/sales/reconciliation";
import type { CatalogItem, EstimateLineItem } from "@/lib/sales/pricing";

/**
 * Proposal Delivery (spec §49-50): human sends the CEO-approved proposal —
 * this route only ever runs after `proposals.status = 'APPROVED'`. Fixes a
 * `sent_at`/`sent_to`/`proposal_version` snapshot so a later edit to the
 * proposal row can never retroactively change what was actually delivered.
 *
 * Reconciliation re-check (spec §46-48): even an already-approved proposal
 * must not go out the door if its scope no longer matches its estimate's
 * priced line items — BLOCKING_MISMATCH refuses delivery outright, forcing
 * a new version instead of sending a mismatched document.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);
    const { supabase, tenantId, userId } = ctx;
    const body = await request.json().catch(() => ({}));
    const sentTo = typeof body.sentTo === "string" ? body.sentTo : null;

    const { data: proposal, error } = await supabase
      .from("proposals")
      .select("id, status, opportunity_id, version, title, scope")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!proposal) throw new NotFoundError("Proposal not found");
    if (proposal.status === "SENT") {
      return { alreadySent: true };
    }
    if (proposal.status !== "APPROVED") {
      throw new ValidationError(`Proposal is not approved yet (status=${proposal.status})`);
    }

    const { data: estimate } = await supabase
      .from("estimates")
      .select("line_items")
      .eq("proposal_id", id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: catalogRows } = await supabase.from("service_catalog").select("code, name, standard_price, setup_fee, pricing_model").eq("tenant_id", tenantId).eq("is_active", true);
    const catalog: CatalogItem[] = (catalogRows ?? []).map((c) => ({
      code: c.code as string,
      name: c.name as string,
      standardPrice: c.standard_price as number,
      setupFee: c.setup_fee as number,
      pricingModel: c.pricing_model as CatalogItem["pricingModel"],
    }));
    const reconciliation = reconcileProposalAndEstimate({
      proposalScope: (proposal.scope as string[] | null) ?? [],
      estimateLineItems: (estimate?.line_items as EstimateLineItem[] | undefined) ?? [],
      catalog,
    });
    if (reconciliation.status === "BLOCKING_MISMATCH") {
      throw new ValidationError(`Delivery blocked: proposal scope and estimate no longer reconcile (${reconciliation.issues.join("; ")}). Create a new version instead.`);
    }

    const { data: updated, error: updateError } = await supabase
      .from("proposals")
      .update({ status: "SENT", sent_at: new Date().toISOString(), sent_to: sentTo })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "APPROVED")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { alreadySent: true };

    await supabase.from("opportunities").update({ stage: "PROPOSAL_SENT" }).eq("id", proposal.opportunity_id as string).eq("tenant_id", tenantId);

    await supabase.from("external_action_logs").insert({
      tenant_id: tenantId,
      action_type: "PROPOSAL_DELIVERY",
      subject_type: "proposal",
      subject_id: id,
      performed_by_user_id: userId,
      status: "SUCCESS",
      payload: { title: proposal.title, version: proposal.version, sentTo },
    });

    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "proposal.sent",
      message: `提案書「${proposal.title}」を送付しました`,
      payload: { proposalId: id, opportunityId: proposal.opportunity_id },
    });

    return { sent: true };
  });
}
