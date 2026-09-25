import type { SupabaseServerClient } from "@/lib/server/tenant";
import { normalizeCompanyName, normalizeDomain } from "@/lib/sales/normalize";

/**
 * Do Not Contact re-check at execution time (spec §11, re-verified again at
 * the Final Send Gate per §45's "re-verify recipient/lead not DNC before
 * sending"): a lead can be added to `do_not_contact` any time after an
 * outreach approval was granted (e.g. a reply arrives requesting no further
 * contact), so this must be checked again immediately before the email
 * actually leaves, not just once back when the lead was first qualified.
 */
export async function isDoNotContact(supabase: SupabaseServerClient, tenantId: string, params: { companyName?: string | null; domain?: string | null }): Promise<boolean> {
  const normalizedCompanyName = params.companyName ? normalizeCompanyName(params.companyName) : null;
  const normalizedDomain = params.domain ? normalizeDomain(params.domain) : null;
  if (!normalizedCompanyName && !normalizedDomain) return false;

  const { data, error } = await supabase.from("do_not_contact").select("id, normalized_company_name, normalized_domain").eq("tenant_id", tenantId);
  if (error) throw error;

  return (data ?? []).some(
    (row) => (normalizedDomain && row.normalized_domain === normalizedDomain) || (normalizedCompanyName && row.normalized_company_name === normalizedCompanyName)
  );
}

export async function addToDoNotContact(
  supabase: SupabaseServerClient,
  tenantId: string,
  params: { companyName?: string | null; domain?: string | null; reason: string; createdByUserId?: string | null }
): Promise<void> {
  const { error } = await supabase.from("do_not_contact").insert({
    tenant_id: tenantId,
    company_name: params.companyName ?? null,
    normalized_company_name: params.companyName ? normalizeCompanyName(params.companyName) : null,
    domain: params.domain ?? null,
    normalized_domain: params.domain ? normalizeDomain(params.domain) : null,
    reason: params.reason,
    created_by_user_id: params.createdByUserId ?? null,
  });
  if (error) throw error;
}
