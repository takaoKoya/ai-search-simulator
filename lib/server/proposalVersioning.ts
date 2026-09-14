import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { computeSnapshotHash } from "@/lib/server/approvalSnapshot";

/**
 * Maps content_json's camelCase keys to the proposal table's snake_case
 * columns the immutability trigger (enforce_proposal_immutability) also
 * protects — kept in one place so a new version's row and its content_json
 * never drift apart.
 */
const PROPOSAL_CONTENT_FIELDS: Array<{ jsonKey: string; column: string }> = [
  { jsonKey: "title", column: "title" },
  { jsonKey: "executiveSummary", column: "executive_summary" },
  { jsonKey: "clientChallenges", column: "client_challenges" },
  { jsonKey: "goals", column: "goals" },
  { jsonKey: "recommendedSolution", column: "recommended_solution" },
  { jsonKey: "scope", column: "scope" },
  { jsonKey: "deliverables", column: "deliverables" },
  { jsonKey: "timeline", column: "timeline" },
  { jsonKey: "kpis", column: "kpis" },
  { jsonKey: "assumptions", column: "assumptions" },
  { jsonKey: "exclusions", column: "exclusions" },
  { jsonKey: "risks", column: "risks" },
  { jsonKey: "nextStep", column: "next_step" },
];

/**
 * Immutable Proposal Versioning (spec §37-39): once a proposal reaches
 * APPROVED/SENT/ACCEPTED, the DB trigger blocks any further edit to its
 * content columns — the only way to change anything is a brand new version
 * row. `contentPatch` (camelCase keys matching content_json, e.g.
 * `{title, scope}`) is shallow-merged onto a copy of the current version's
 * content_json; every unpatched field carries over unchanged. The new row
 * always starts back at DRAFT/un-reviewed — a new version must go through
 * Critic + Approval again, it never inherits the old approval.
 */
export async function createNewProposalVersion(ctx: TenantContext, proposalId: string, params: { changeSummary: string; contentPatch?: Record<string, unknown> }): Promise<string> {
  const { supabase, tenantId } = ctx;
  if (!params.changeSummary || params.changeSummary.trim().length === 0) {
    throw new ValidationError("changeSummary is required when creating a new proposal version");
  }

  const { data: current, error } = await supabase.from("proposals").select("*").eq("id", proposalId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!current) throw new NotFoundError("Proposal not found");

  const newContentJson: Record<string, unknown> = { ...((current.content_json as Record<string, unknown> | null) ?? {}), ...(params.contentPatch ?? {}) };

  const columnOverrides: Record<string, unknown> = {};
  for (const { jsonKey, column } of PROPOSAL_CONTENT_FIELDS) {
    if (jsonKey in newContentJson) columnOverrides[column] = newContentJson[jsonKey];
  }

  const nextVersion = (current.version as number) + 1;
  const { data: newRow, error: insertError } = await supabase
    .from("proposals")
    .insert({
      tenant_id: tenantId,
      opportunity_id: current.opportunity_id,
      version: nextVersion,
      previous_version_id: current.id,
      status: "DRAFT",
      change_summary: params.changeSummary.trim(),
      content_json: newContentJson,
      snapshot_hash: computeSnapshotHash(newContentJson),
      ...columnOverrides,
    })
    .select("id")
    .single();
  if (insertError || !newRow) throw insertError ?? new Error("Failed to create new proposal version");

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: "proposal.new_version_created",
    message: `提案書の新バージョンを作成しました（v${nextVersion}）: ${params.changeSummary.trim()}`,
    payload: { proposalId: newRow.id, previousVersionId: current.id, opportunityId: current.opportunity_id, version: nextVersion },
  });

  return newRow.id as string;
}
