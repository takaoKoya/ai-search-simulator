import type { NextRequest } from "next/server";
import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { createNewProposalVersion } from "@/lib/server/proposalVersioning";

/**
 * Explicit "create a new version" action (spec §37-39) — the only way to
 * change a proposal once it has reached APPROVED/SENT/ACCEPTED, since the DB
 * trigger blocks any direct edit at that point. The new version starts back
 * at DRAFT and must go through Critic + Approval again from scratch.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);

    const body = await request.json().catch(() => ({}));
    const changeSummary = typeof body.changeSummary === "string" ? body.changeSummary : "";
    if (!changeSummary.trim()) throw new ValidationError("changeSummary is required");
    const contentPatch = body.contentPatch && typeof body.contentPatch === "object" ? (body.contentPatch as Record<string, unknown>) : undefined;

    const newProposalId = await createNewProposalVersion(ctx, id, { changeSummary, contentPatch });
    return { proposalId: newProposalId };
  });
}
