import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { sendDeliveryPackage } from "@/lib/server/deliveryPackage";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);
    await sendDeliveryPackage(ctx, id);
    return { sent: true };
  });
}
