import type { SupabaseServerClient } from "@/lib/server/tenant";
import { normalizeCompanyName, normalizeDomain } from "@/lib/sales/normalize";

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
