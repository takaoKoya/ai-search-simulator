import type { SupabaseServerClient } from "@/lib/server/tenant";
import { normalizeCompanyName } from "@/lib/sales/normalize";

export type DuplicateStatus = "NEW" | "EXISTING_LEAD" | "EXISTING_CLIENT" | "PREVIOUSLY_CONTACTED" | "BLOCKED" | "POSSIBLE_DUPLICATE";

export interface DuplicateCheckResult {
  status: DuplicateStatus;
  matchedLeadId?: string;
  reason: string;
}

const CLOSED_OUT_STATUSES = new Set(["lost", "rejected"]);
const CLOSED_OUT_STAGES = new Set(["LOST", "REJECTED", "BLOCKED"]);

/**
 * Duplicate/exclusion check run before a candidate is allowed to become a
 * new Lead. Domain is treated as the strong duplicate key (spec §10); a
 * name-only match without a domain match is surfaced as POSSIBLE_DUPLICATE
 * for a human to confirm rather than silently merged or silently created.
 */
export async function checkDuplicate(
  supabase: SupabaseServerClient,
  tenantId: string,
  candidate: { normalizedDomain: string | null; normalizedCompanyName: string | null; excludeLeadId?: string }
): Promise<DuplicateCheckResult> {
  const { normalizedDomain, normalizedCompanyName, excludeLeadId } = candidate;

  if (normalizedDomain) {
    const { data } = await supabase
      .from("do_not_contact")
      .select("id, reason")
      .eq("tenant_id", tenantId)
      .eq("normalized_domain", normalizedDomain)
      .maybeSingle();
    if (data) return { status: "BLOCKED", reason: `Do Not Contact: ${data.reason}` };
  }
  if (normalizedCompanyName) {
    const { data } = await supabase
      .from("do_not_contact")
      .select("id, reason")
      .eq("tenant_id", tenantId)
      .eq("normalized_company_name", normalizedCompanyName)
      .maybeSingle();
    if (data) return { status: "BLOCKED", reason: `Do Not Contact: ${data.reason}` };
  }

  if (normalizedCompanyName) {
    const { data: clients } = await supabase.from("clients").select("id, name").eq("tenant_id", tenantId);
    const match = (clients ?? []).find((c) => normalizeCompanyName(c.name as string) === normalizedCompanyName);
    if (match) return { status: "EXISTING_CLIENT", reason: `既存クライアント「${match.name}」と一致` };
  }

  if (normalizedDomain) {
    let query = supabase
      .from("leads")
      .select("id, status, discovery_stage")
      .eq("tenant_id", tenantId)
      .eq("normalized_domain", normalizedDomain);
    if (excludeLeadId) query = query.neq("id", excludeLeadId);
    const { data: lead } = await query.maybeSingle();
    if (lead) {
      const closedOut = CLOSED_OUT_STATUSES.has(lead.status as string) || CLOSED_OUT_STAGES.has((lead.discovery_stage as string) ?? "");
      return closedOut
        ? { status: "PREVIOUSLY_CONTACTED", matchedLeadId: lead.id as string, reason: "過去に営業対象だったが不成立（同一ドメイン）" }
        : { status: "EXISTING_LEAD", matchedLeadId: lead.id as string, reason: "同一ドメインの既存Leadが存在" };
    }
  }

  if (normalizedCompanyName) {
    let query = supabase
      .from("leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("normalized_company_name", normalizedCompanyName);
    if (excludeLeadId) query = query.neq("id", excludeLeadId);
    const { data: lead } = await query.maybeSingle();
    if (lead) {
      return {
        status: "POSSIBLE_DUPLICATE",
        matchedLeadId: lead.id as string,
        reason: "会社名が類似する既存Leadが存在（ドメイン不一致のため要確認）",
      };
    }
  }

  return { status: "NEW", reason: "重複なし" };
}
