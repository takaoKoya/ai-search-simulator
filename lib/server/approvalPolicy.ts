import type { SupabaseServerClient } from "@/lib/server/tenant";

/**
 * Manager Approval Queue / Approval Policy routing (spec §51-53). Pure,
 * unit-testable functions in the same style as lib/sales/pricing.ts's
 * evaluateDiscountGuard() — no AI/generation involved, just deterministic
 * threshold matching against a tenant's `approval_policies` rows.
 */

export interface ApprovalStep {
  role: string;
  status?: string;
  approver_user_id?: string | null;
  decided_at?: string | null;
}

export interface ApprovalPolicyRow {
  code: string;
  conditions: Record<string, unknown>;
  steps: ApprovalStep[];
  is_active: boolean;
}

export interface PolicyMatchContext {
  amount?: number;
  discountRate?: number;
}

/**
 * Empty conditions ({}) always match — used by policies like "sales_send" /
 * "deal_won" / "delivery" that gate on role alone, not on any threshold.
 */
export function matchesConditions(conditions: Record<string, unknown> | null | undefined, context: PolicyMatchContext): boolean {
  const c = conditions ?? {};
  if (Object.keys(c).length === 0) return true;

  if (typeof c.amountLt === "number" && !(context.amount != null && context.amount < c.amountLt)) return false;
  if (typeof c.amountGte === "number" && !(context.amount != null && context.amount >= c.amountGte)) return false;
  if (typeof c.discountRateLte === "number" && !(context.discountRate != null && context.discountRate <= c.discountRateLte)) return false;
  if (typeof c.discountRateGt === "number" && !(context.discountRate != null && context.discountRate > c.discountRateGt)) return false;

  return true;
}

/**
 * Picks the one policy from a code "family" (e.g. `estimate_amount_low` /
 * `estimate_amount_high` share the prefix `estimate_amount`) whose
 * conditions match the given context. A policy whose code equals the prefix
 * exactly (e.g. `sales_send`, no suffix) is also matched — that is the case
 * for policies with no threshold family at all.
 */
export function selectApprovalPolicy(policies: ApprovalPolicyRow[], codePrefix: string, context: PolicyMatchContext): ApprovalPolicyRow | null {
  const candidates = policies.filter((p) => p.is_active && (p.code === codePrefix || p.code.startsWith(`${codePrefix}_`)));
  return candidates.find((p) => matchesConditions(p.conditions, context)) ?? null;
}

const ROLE_ORDER = ["manager", "ceo"];

/**
 * Merges the role requirements of one or more matched policies into a single
 * ordered, deduped step chain (manager always before ceo). Returns an empty
 * `steps` array when nothing matches (e.g. tenant has no approval_policies
 * seeded yet) — callers must treat that as "no policy routing configured"
 * and fall back to legacy behavior, never as an error.
 */
export function computeApprovalSteps(
  policies: ApprovalPolicyRow[],
  requests: Array<{ codePrefix: string; context: PolicyMatchContext }>
): { steps: ApprovalStep[]; policyCodes: string[] } {
  const roles = new Set<string>();
  const policyCodes: string[] = [];

  for (const req of requests) {
    const matched = selectApprovalPolicy(policies, req.codePrefix, req.context);
    if (matched) {
      policyCodes.push(matched.code);
      for (const step of matched.steps) roles.add(step.role);
    }
  }

  const orderedRoles = [...ROLE_ORDER.filter((r) => roles.has(r)), ...Array.from(roles).filter((r) => !ROLE_ORDER.includes(r))];
  const steps: ApprovalStep[] = orderedRoles.map((role) => ({ role, status: "PENDING" }));

  return { steps, policyCodes };
}

export async function loadApprovalPolicies(supabase: SupabaseServerClient, tenantId: string): Promise<ApprovalPolicyRow[]> {
  const { data, error } = await supabase.from("approval_policies").select("code, conditions, steps, is_active").eq("tenant_id", tenantId).eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as ApprovalPolicyRow[];
}
