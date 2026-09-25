import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { getOpportunityDetailState } from "@/lib/server/opportunityDetail";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    return getOpportunityDetailState(ctx, id);
  });
}
