import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { decideApproval, type ApprovalAction } from "@/lib/server/approvals";

const VALID_ACTIONS: ApprovalAction[] = ["approve", "reject", "revise"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);

    const body = await request.json().catch(() => ({}));
    const action = body.action as ApprovalAction;
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const editNote = typeof body.editNote === "string" ? body.editNote : undefined;
    if (!VALID_ACTIONS.includes(action)) {
      throw new ValidationError(`action must be one of: ${VALID_ACTIONS.join(", ")}`);
    }

    const result = await decideApproval(ctx, id, action, reason, editNote);
    return result;
  });
}
