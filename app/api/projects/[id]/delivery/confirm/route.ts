import { DECISION_CAPABLE_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { confirmProjectDelivery, type DeliveryChannel } from "@/lib/server/deliveryConfirmation";

const VALID_CHANNELS: DeliveryChannel[] = ["email", "meeting", "portal", "other"];

/** Human Delivery (spec §2-3): the explicit action that moves READY_FOR_DELIVERY -> DELIVERED. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    // Any manager-and-up can record an actual delivery — the internal
    // Manager+CEO approval already happened to reach READY_FOR_DELIVERY.
    assertRole(ctx, DECISION_CAPABLE_ROLES);

    const body = await request.json().catch(() => ({}));
    const deliveryChannel = (body.deliveryChannel as DeliveryChannel | undefined) ?? "email";
    if (!VALID_CHANNELS.includes(deliveryChannel)) {
      throw new ValidationError(`deliveryChannel must be one of: ${VALID_CHANNELS.join(", ")}`);
    }
    const recipient = typeof body.recipient === "string" ? body.recipient : null;
    const notes = typeof body.notes === "string" ? body.notes : null;

    return confirmProjectDelivery(ctx, id, { deliveryChannel, recipient, notes });
  });
}
