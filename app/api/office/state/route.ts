import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { getOfficeState } from "@/lib/server/officeState";

export async function GET() {
  return withRoute(async () => {
    const ctx = await getTenantContext();
    return getOfficeState(ctx);
  });
}
