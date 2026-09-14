import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { computeSnapshotHash } from "@/lib/server/approvalSnapshot";

const ESTIMATE_CONTENT_FIELDS: Array<{ jsonKey: string; column: string }> = [
  { jsonKey: "lineItems", column: "line_items" },
  { jsonKey: "subtotal", column: "subtotal" },
  { jsonKey: "discount", column: "discount" },
  { jsonKey: "tax", column: "tax" },
  { jsonKey: "total", column: "total" },
  { jsonKey: "setupFee", column: "setup_fee" },
  { jsonKey: "monthlyFee", column: "monthly_fee" },
  { jsonKey: "annualValue", column: "annual_value" },
];

/**
 * Immutable Estimate Versioning — the exact same mechanic as
 * lib/server/proposalVersioning.ts, for the estimates table's own
 * immutability trigger (enforce_estimate_immutability).
 */
export async function createNewEstimateVersion(ctx: TenantContext, estimateId: string, params: { changeSummary: string; contentPatch?: Record<string, unknown> }): Promise<string> {
  const { supabase, tenantId } = ctx;
  if (!params.changeSummary || params.changeSummary.trim().length === 0) {
    throw new ValidationError("changeSummary is required when creating a new estimate version");
  }

  const { data: current, error } = await supabase.from("estimates").select("*").eq("id", estimateId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!current) throw new NotFoundError("Estimate not found");

  const newContentJson: Record<string, unknown> = { ...((current.content_json as Record<string, unknown> | null) ?? {}), ...(params.contentPatch ?? {}) };

  const columnOverrides: Record<string, unknown> = {};
  for (const { jsonKey, column } of ESTIMATE_CONTENT_FIELDS) {
    if (jsonKey in newContentJson) columnOverrides[column] = newContentJson[jsonKey];
  }

  const nextVersion = (current.version as number) + 1;
  const { data: newRow, error: insertError } = await supabase
    .from("estimates")
    .insert({
      tenant_id: tenantId,
      proposal_id: current.proposal_id,
      opportunity_id: current.opportunity_id,
      version: nextVersion,
      previous_version_id: current.id,
      status: "DRAFT",
      payment_terms: current.payment_terms,
      change_summary: params.changeSummary.trim(),
      content_json: newContentJson,
      snapshot_hash: computeSnapshotHash(newContentJson),
      ...columnOverrides,
    })
    .select("id")
    .single();
  if (insertError || !newRow) throw insertError ?? new Error("Failed to create new estimate version");

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: "estimate.new_version_created",
    message: `見積の新バージョンを作成しました（v${nextVersion}）: ${params.changeSummary.trim()}`,
    payload: { estimateId: newRow.id, previousVersionId: current.id, opportunityId: current.opportunity_id, version: nextVersion },
  });

  return newRow.id as string;
}
