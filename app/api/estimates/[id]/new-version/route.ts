import type { NextRequest } from "next/server";
import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { createNewEstimateVersion } from "@/lib/server/estimateVersioning";

/** Estimate counterpart of /api/proposals/[id]/new-version — see that route's comment. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);

    const body = await request.json().catch(() => ({}));
    const changeSummary = typeof body.changeSummary === "string" ? body.changeSummary : "";
    if (!changeSummary.trim()) throw new ValidationError("changeSummary is required");
    const contentPatch = body.contentPatch && typeof body.contentPatch === "object" ? (body.contentPatch as Record<string, unknown>) : undefined;

    const newEstimateId = await createNewEstimateVersion(ctx, id, { changeSummary, contentPatch });
    return { estimateId: newEstimateId };
  });
}
