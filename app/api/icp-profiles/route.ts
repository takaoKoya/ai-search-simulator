import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";

export async function GET() {
  return withRoute(async () => {
    const { supabase, tenantId } = await getTenantContext();
    const { data, error } = await supabase
      .from("icp_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { icpProfiles: data ?? [] };
  });
}

export async function POST(request: NextRequest) {
  return withRoute(async () => {
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ValidationError("name is required");

    const { data, error } = await supabase
      .from("icp_profiles")
      .insert({
        tenant_id: tenantId,
        name,
        is_default: Boolean(body.isDefault),
        target_industries: body.targetIndustries ?? [],
        target_regions: body.targetRegions ?? ["全国"],
        employee_size_min: body.employeeSizeMin ?? null,
        employee_size_max: body.employeeSizeMax ?? null,
        revenue_range: body.revenueRange ?? null,
        business_model: body.businessModel ?? null,
        requires_website: body.requiresWebsite ?? null,
        requires_ecommerce: body.requiresEcommerce ?? null,
        requires_physical_store: body.requiresPhysicalStore ?? null,
        ad_spend_expected: body.adSpendExpected ?? null,
        seo_state_target: body.seoStateTarget ?? null,
        meo_importance: body.meoImportance ?? null,
        aio_fit_target: body.aioFitTarget ?? null,
        site_update_expectation: body.siteUpdateExpectation ?? null,
        hiring_signal_weight: body.hiringSignalWeight ?? null,
        target_services: body.targetServices ?? [],
        target_price_floor: body.targetPriceFloor ?? null,
        exclusion_conditions: body.exclusionConditions ?? [],
        score_weights: body.scoreWeights ?? undefined,
        qualification_thresholds: body.qualificationThresholds ?? undefined,
      })
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create ICP profile");
    return { icpProfile: data };
  });
}
