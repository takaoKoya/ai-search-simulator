import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { createDeliveryPackage } from "@/lib/server/deliveryPackage";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();

    const body = await request.json().catch(() => ({}));
    const proposalId = typeof body.proposalId === "string" ? body.proposalId : null;
    if (!proposalId) throw new ValidationError("proposalId is required");
    const coverMessage = typeof body.coverMessage === "string" ? body.coverMessage : null;

    const packageId = await createDeliveryPackage(ctx, { opportunityId: id, proposalId, coverMessage });
    return { packageId };
  });
}
