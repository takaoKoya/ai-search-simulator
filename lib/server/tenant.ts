import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/server/errors";

export type TenantRole = "owner" | "ceo" | "admin" | "manager" | "member";

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface TenantContext {
  supabase: SupabaseServerClient;
  userId: string;
  userEmail: string | null;
  tenantId: string;
  role: TenantRole;
}

/**
 * Resolves the acting tenant from the authenticated session's membership row.
 * tenant_id must never be accepted from request bodies/query params — this is
 * the only place tenant_id is allowed to originate from.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UnauthorizedError();
  }

  const { data: membership, error } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!membership) {
    throw new UnauthorizedError("Authenticated user has no tenant membership");
  }

  return {
    supabase,
    userId: user.id,
    userEmail: user.email ?? null,
    tenantId: membership.tenant_id as string,
    role: membership.role as TenantRole,
  };
}

export function assertRole(ctx: TenantContext, allowed: TenantRole[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new ForbiddenError(
      `Role "${ctx.role}" cannot perform this action (requires one of: ${allowed.join(", ")})`
    );
  }
}

export const APPROVER_ROLES: TenantRole[] = ["owner", "ceo", "admin"];

/**
 * Roles allowed to reach the shared approval-decision endpoint at all (spec
 * §51-53's Manager Approval Queue). This is intentionally broader than
 * APPROVER_ROLES: a "manager" may only ever decide the approval types/steps
 * that `approval_policies` actually route to them — that fine-grained check
 * happens inside decideApproval() (lib/server/approvals.ts), not here. Every
 * other route that performs a privileged action directly (send, contract
 * lost, etc.) keeps using APPROVER_ROLES unchanged.
 */
export const DECISION_CAPABLE_ROLES: TenantRole[] = ["owner", "ceo", "admin", "manager"];
