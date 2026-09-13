import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";

const PATCHABLE_FIELDS: Record<string, string> = {
  name: "name",
  isDefault: "is_default",
  isActive: "is_active",
  targetIndustries: "target_industries",
  targetRegions: "target_regions",
  employeeSizeMin: "employee_size_min",
  employeeSizeMax: "employee_size_max",
  revenueRange: "revenue_range",
  businessModel: "business_model",
  requiresWebsite: "requires_website",
  requiresEcommerce: "requires_ecommerce",
  requiresPhysicalStore: "requires_physical_store",
  adSpendExpected: "ad_spend_expected",
  seoStateTarget: "seo_state_target",
  meoImportance: "meo_importance",
  aioFitTarget: "aio_fit_target",
  siteUpdateExpectation: "site_update_expectation",
  hiringSignalWeight: "hiring_signal_weight",
  targetServices: "target_services",
  targetPriceFloor: "target_price_floor",
  exclusionConditions: "exclusion_conditions",
  scoreWeights: "score_weights",
  qualificationThresholds: "qualification_thresholds",
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));

    const update: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(PATCHABLE_FIELDS)) {
      if (key in body) update[column] = body[key];
    }

    const { data, error } = await supabase
      .from("icp_profiles")
      .update(update)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError("ICP profile not found");
    return { icpProfile: data };
  });
}
