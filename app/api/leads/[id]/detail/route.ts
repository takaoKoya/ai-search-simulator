import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { getLeadDetailState } from "@/lib/server/leadDetail";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    return getLeadDetailState(ctx, id);
  });
}
