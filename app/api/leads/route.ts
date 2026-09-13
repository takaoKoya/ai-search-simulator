import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";

export async function GET() {
  return withRoute(async () => {
    const { supabase, tenantId } = await getTenantContext();
    const { data, error } = await supabase
      .from("leads")
      .select("id, company_name, industry, website, status, score, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { leads: data ?? [] };
  });
}

export async function POST(request: NextRequest) {
  return withRoute(async () => {
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));
    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
    const industry = typeof body.industry === "string" ? body.industry.trim() : "";
    const website = typeof body.website === "string" ? body.website.trim() : null;
    if (!companyName) throw new ValidationError("companyName is required");

    const { data: lead, error } = await supabase
      .from("leads")
      .insert({ tenant_id: tenantId, company_name: companyName, industry: industry || null, website, source: "manual", status: "new" })
      .select("id, company_name, industry, website, status, created_at")
      .single();
    if (error || !lead) throw error ?? new Error("Failed to create lead");

    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "lead.created",
      message: `新規Lead「${companyName}」を登録`,
      payload: { leadId: lead.id },
    });

    return { lead };
  });
}
