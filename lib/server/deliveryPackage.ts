import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { computeSnapshotHash } from "@/lib/server/approvalSnapshot";

const CLIENT_VISIBLE_ELIGIBLE_STATUSES = ["APPROVED", "SENT", "ACCEPTED"];

/**
 * Delivery Package (spec §48-49): bundles an APPROVED proposal + its
 * estimate + their CLIENT_VISIBLE generated files into one shareable unit.
 * Never allows a DRAFT file into a package — only files already classified
 * CLIENT_VISIBLE (which itself only happens once the source proposal is
 * APPROVED/SENT/ACCEPTED, see documentGeneration.ts) may be attached.
 */
export async function createDeliveryPackage(ctx: TenantContext, params: { opportunityId: string; proposalId: string; coverMessage?: string | null }): Promise<string> {
  const { supabase, tenantId } = ctx;

  const { data: proposal, error } = await supabase.from("proposals").select("id, status, opportunity_id").eq("id", params.proposalId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!proposal) throw new NotFoundError("Proposal not found");
  if (!CLIENT_VISIBLE_ELIGIBLE_STATUSES.includes(proposal.status as string)) {
    throw new ValidationError(`Proposal must be approved before it can be packaged for delivery (status=${proposal.status})`);
  }

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id")
    .eq("proposal_id", params.proposalId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!estimate) throw new ValidationError("No estimate exists for this proposal");

  const { data: files } = await supabase.from("generated_files").select("id, classification").eq("tenant_id", tenantId).eq("entity_type", "proposal").eq("entity_id", params.proposalId);
  const clientVisibleFileIds = (files ?? []).filter((f) => f.classification === "CLIENT_VISIBLE").map((f) => f.id as string);
  if (clientVisibleFileIds.length === 0) {
    throw new ValidationError("No CLIENT_VISIBLE file exists for this proposal yet — generate a PDF/PPTX after approval first");
  }

  const packageHash = computeSnapshotHash({ proposalId: params.proposalId, estimateId: estimate.id, fileIds: clientVisibleFileIds });

  const { data: pkg, error: insertError } = await supabase
    .from("delivery_packages")
    .insert({
      tenant_id: tenantId,
      opportunity_id: params.opportunityId,
      proposal_id: params.proposalId,
      estimate_id: estimate.id,
      cover_message: params.coverMessage ?? null,
      attachment_file_ids: clientVisibleFileIds,
      package_hash: packageHash,
      status: "DRAFT",
    })
    .select("id")
    .single();
  if (insertError || !pkg) throw insertError ?? new Error("Failed to create delivery package");

  return pkg.id as string;
}

/**
 * Marks a package SENT — the actual "hand this to the client" action.
 * Refuses to send if any attached file is no longer CLIENT_VISIBLE (defense
 * in depth on top of createDeliveryPackage's own check, in case
 * classification changed in between).
 */
export async function sendDeliveryPackage(ctx: TenantContext, packageId: string): Promise<void> {
  const { supabase, tenantId } = ctx;
  const { data: pkg, error } = await supabase.from("delivery_packages").select("id, status, attachment_file_ids").eq("id", packageId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!pkg) throw new NotFoundError("Delivery package not found");
  if (pkg.status === "SENT") return;

  const fileIds = (pkg.attachment_file_ids as string[]) ?? [];
  if (fileIds.length > 0) {
    const { data: files } = await supabase.from("generated_files").select("id, classification").eq("tenant_id", tenantId).in("id", fileIds);
    const allVisible = (files ?? []).every((f) => f.classification === "CLIENT_VISIBLE");
    if (!allVisible) {
      throw new ValidationError("One or more attached files are no longer CLIENT_VISIBLE — cannot send this package.");
    }
  }

  const { error: updateError } = await supabase.from("delivery_packages").update({ status: "SENT", sent_at: new Date().toISOString() }).eq("id", packageId).eq("tenant_id", tenantId);
  if (updateError) throw updateError;
}
