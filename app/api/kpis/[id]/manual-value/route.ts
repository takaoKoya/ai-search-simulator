import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { recordManualKpiValue } from "@/lib/server/manualKpi";

/** Manual KPI Input (spec §127-128): any tenant member may enter a reading for a connector-less KPI, always audited. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();

    const body = await request.json().catch(() => ({}));
    const value = Number(body.value);
    if (!Number.isFinite(value)) throw new ValidationError("value must be a finite number");
    const reason = typeof body.reason === "string" ? body.reason : null;

    await recordManualKpiValue(ctx, id, { value, reason });
    return { updated: true };
  });
}
