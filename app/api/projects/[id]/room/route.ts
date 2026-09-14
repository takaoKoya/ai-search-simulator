import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { getProjectRoomState } from "@/lib/server/projectRoom";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    return getProjectRoomState(ctx, id);
  });
}
