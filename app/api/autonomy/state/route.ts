import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { getAutonomyCockpitState } from "@/lib/server/autonomyCockpit";

export async function GET() {
  return withRoute(async () => {
    const ctx = await getTenantContext();
    return getAutonomyCockpitState(ctx);
  });
}
