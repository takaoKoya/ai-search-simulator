import { DECISION_CAPABLE_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { deliverMonthlyReport } from "@/lib/server/reportDelivery";

/** Report Delivery (spec §55-56): explicit Human Send after internal approval. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, DECISION_CAPABLE_ROLES);
    return deliverMonthlyReport(ctx, id);
  });
}
