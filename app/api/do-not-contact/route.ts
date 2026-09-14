import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { addToDoNotContact } from "@/lib/sales/dnc";

export async function GET() {
  return withRoute(async () => {
    const { supabase, tenantId } = await getTenantContext();
    const { data, error } = await supabase
      .from("do_not_contact")
      .select("id, company_name, domain, reason, created_at, expires_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { entries: data ?? [] };
  });
}

export async function POST(request: NextRequest) {
  return withRoute(async () => {
    const { supabase, tenantId, userId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : null;
    const domain = typeof body.domain === "string" ? body.domain.trim() : null;
    if (!reason) throw new ValidationError("reason is required");
    if (!companyName && !domain) throw new ValidationError("companyName or domain is required");

    await addToDoNotContact(supabase, tenantId, { companyName, domain, reason, createdByUserId: userId });
    return { ok: true };
  });
}
