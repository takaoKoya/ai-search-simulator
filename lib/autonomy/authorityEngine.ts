/**
 * AuthorityEngine (spec §8/FINAL CHANGE 3) — the only component allowed to
 * set `works.authority_decision`. Per the authorized plan, "a Work is never
 * just created, it's created *and immediately authority-evaluated* in the
 * same flow" — this module owns both halves.
 *
 * `evaluateAuthority()` is a pure function: its input type has no
 * `confidence` field at all, so it is structurally impossible for it to read
 * Planner confidence (spec FINAL CHANGE 6). It reuses the exact same
 * `approval_policies` matching logic (`selectApprovalPolicy`) the existing
 * Approval Engine already uses for every other approval type — Hard DENY is
 * just `approval_policies.hard_deny` on whichever policy matches.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import { ValidationError } from "@/lib/server/errors";
import { assertNotStopped } from "@/lib/autonomy/killSwitch";
import { transitionCycle, transitionWork } from "@/lib/autonomy/stateTransition";
import { loadApprovalPolicies, selectApprovalPolicy, type ApprovalPolicyRow } from "@/lib/server/approvalPolicy";
import type { AuthorityDecision, ProposedWork, WorkStatus } from "@/lib/autonomy/types";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";

interface SkillDefinitionRow {
  id: string;
  name: string;
  risk_level: string;
  approval_policy_code: string | null;
  enabled: boolean;
}

async function getSkillDefinition(supabase: SupabaseServerClient, tenantId: string, skillId: string): Promise<SkillDefinitionRow | null> {
  const { data, error } = await supabase.from("skill_definitions").select("id, name, risk_level, approval_policy_code, enabled").eq("id", skillId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return (data as SkillDefinitionRow | null) ?? null;
}

/** Same style as lib/ai/provider.ts's seededScore — no new hashing approach introduced for PHASE 1. */
function fnv1aHex(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic per spec §7/CHANGE 11 — a retried/duplicated Work-creation attempt for the same (objective, observation, skill, cycle) always yields the same key. */
export function computeWorkIdempotencyKey(parts: { tenantId: string; objectiveId: string; observationId: string; skillDefinitionId: string; cycleId: string }): string {
  const seed = [parts.tenantId, parts.objectiveId, parts.observationId, parts.skillDefinitionId, parts.cycleId].join("|");
  return `work_${fnv1aHex(seed)}`;
}

export interface AuthorityEvaluationInput {
  skillApprovalPolicyCode: string | null;
  estimatedCost: number;
  policies: ApprovalPolicyRow[];
}

export interface AuthorityEvaluationResult {
  decision: AuthorityDecision;
  policyCode: string | null;
  matchedPolicy: ApprovalPolicyRow | null;
}

/**
 * Pure decision function — no DB access, no `confidence` in its input type.
 * A skill with no approval_policy_code at all is AUTO (nothing gates it). A
 * skill that names a policy family but has no matching policy row falls back
 * to APPROVAL, never AUTO — an unresolvable policy must never silently
 * default to auto-execution.
 */
export function evaluateAuthority(input: AuthorityEvaluationInput): AuthorityEvaluationResult {
  if (!input.skillApprovalPolicyCode) {
    return { decision: "AUTO", policyCode: null, matchedPolicy: null };
  }

  const matched = selectApprovalPolicy(input.policies, input.skillApprovalPolicyCode, { amount: input.estimatedCost });
  if (!matched) {
    return { decision: "APPROVAL", policyCode: null, matchedPolicy: null };
  }
  if (matched.hard_deny) {
    return { decision: "DENY", policyCode: matched.code, matchedPolicy: matched };
  }
  if (matched.steps.length === 0) {
    return { decision: "AUTO", policyCode: matched.code, matchedPolicy: matched };
  }
  return { decision: "APPROVAL", policyCode: matched.code, matchedPolicy: matched };
}

const STATUS_BY_DECISION: Record<AuthorityDecision, WorkStatus> = {
  AUTO: "APPROVED",
  APPROVAL: "AUTHORITY_PENDING",
  DENY: "DENIED",
};

export interface CreateAndAuthorizeWorkParams {
  cycleId: string;
  objectiveId: string;
  planProposalId: string;
  observationId: string | null;
  proposedWork: ProposedWork;
}

export interface CreateAndAuthorizeWorkResult {
  workId: string;
  status: WorkStatus;
  /** Null only on the `duplicate` path, if the existing row's own authorization somehow hasn't completed. */
  authorityDecision: AuthorityDecision | null;
  authorityPolicyCode: string | null;
  /** True when this call resolved to an already-existing Work (same idempotency key) instead of creating a new one. */
  duplicate: boolean;
}

async function findExistingWorkByIdempotencyKey(supabase: SupabaseServerClient, tenantId: string, idempotencyKey: string) {
  const { data, error } = await supabase
    .from("works")
    .select("id, status, authority_decision, authority_policy_code")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; status: WorkStatus; authority_decision: AuthorityDecision | null; authority_policy_code: string | null } | null;
}

/**
 * Creates one Work row from a CREATE_WORK PlanProposal's proposedWork and
 * immediately authority-evaluates it in the same flow (spec §8/migration
 * order step 8 — the two are never separated). AUTO/DENY leave the Work
 * immediately actionable (APPROVED/DENIED); APPROVAL reuses the *existing*
 * approval_requests/decideApproval() mechanism unchanged, with
 * `type='work_creation'` — a human decides it exactly like every other
 * approval type, and Hard DENY there is enforced by lib/server/approvals.ts,
 * not here (this function never creates an approval_requests row for a
 * hard_deny match; there is nothing to ask a human about).
 */
export async function createAndAuthorizeWork(supabase: SupabaseServerClient, tenantId: string, params: CreateAndAuthorizeWorkParams): Promise<CreateAndAuthorizeWorkResult> {
  await assertNotStopped(supabase, tenantId);

  const idempotencyKey = computeWorkIdempotencyKey({
    tenantId,
    objectiveId: params.objectiveId,
    observationId: params.observationId ?? "",
    skillDefinitionId: params.proposedWork.skillDefinitionId,
    cycleId: params.cycleId,
  });

  // Idempotency (spec §19/CHANGE 11): the real enforcement is the DB's
  // `unique (tenant_id, idempotency_key)` constraint in the migration — this
  // pre-check is a fast, deterministic path (also the only path our
  // in-memory FakeSupabase test double can exercise, since it does not
  // simulate unique-constraint violations) that turns a legitimate retry
  // into a no-op lookup instead of a duplicate Work.
  const existing = await findExistingWorkByIdempotencyKey(supabase, tenantId, idempotencyKey);
  if (existing) {
    return { workId: existing.id, status: existing.status, authorityDecision: existing.authority_decision, authorityPolicyCode: existing.authority_policy_code, duplicate: true };
  }

  try {
    const skill = await getSkillDefinition(supabase, tenantId, params.proposedWork.skillDefinitionId);
    if (!skill || !skill.enabled) {
      throw new ValidationError(`Skill ${params.proposedWork.skillDefinitionId} is not available`);
    }

    const { data: workRow, error: insertError } = await supabase
      .from("works")
      .insert({
        tenant_id: tenantId,
        objective_id: params.objectiveId,
        plan_proposal_id: params.planProposalId,
        cycle_id: params.cycleId,
        observation_id: params.observationId,
        skill_definition_id: skill.id,
        title: params.proposedWork.title,
        description: params.proposedWork.description ?? null,
        expected_outcome: params.proposedWork.expectedOutcome ?? null,
        priority: params.proposedWork.priority,
        status: "PROPOSED",
        estimated_cost: params.proposedWork.estimatedCost,
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (insertError || !workRow) throw insertError ?? new Error("Failed to create works row");
    const workId = workRow.id as string;

    const policies = await loadApprovalPolicies(supabase, tenantId);
    const evaluation = evaluateAuthority({ skillApprovalPolicyCode: skill.approval_policy_code, estimatedCost: params.proposedWork.estimatedCost, policies });
    const nextStatus = STATUS_BY_DECISION[evaluation.decision];

    await supabase.from("works").update({ authority_decision: evaluation.decision, authority_policy_code: evaluation.policyCode }).eq("id", workId).eq("tenant_id", tenantId);
    await transitionWork(supabase, tenantId, workId, nextStatus);

    if (evaluation.decision === "APPROVAL") {
      await supabase.from("approval_requests").insert({
        tenant_id: tenantId,
        type: "work_creation",
        subject_type: "work",
        subject_id: workId,
        title: `Work: ${params.proposedWork.title}`,
        risk_level: skill.risk_level,
        ai_recommendation: params.proposedWork.expectedOutcome ?? null,
        steps: evaluation.matchedPolicy?.steps ?? [],
        current_step: 0,
        policy_code: evaluation.policyCode,
        cycle_id: params.cycleId,
      });
    }

    await writeDecisionLog(supabase, tenantId, {
      cycleId: params.cycleId,
      objectiveId: params.objectiveId,
      workId,
      stage: "AUTHORIZE",
      actorType: "SYSTEM",
      action: evaluation.decision,
      reasoningSummary: `Skill "${skill.name}" (risk=${skill.risk_level}) evaluated against policy ${evaluation.policyCode ?? "(none)"}`,
      reasonCodes: [`AUTHORITY_${evaluation.decision}`],
    });
    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "work.created",
      message: `Work作成: ${params.proposedWork.title} (${evaluation.decision})`,
      payload: { objectiveId: params.objectiveId, cycleId: params.cycleId, workId, authorityDecision: evaluation.decision },
    });

    return { workId, status: nextStatus, authorityDecision: evaluation.decision, authorityPolicyCode: evaluation.policyCode, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionCycle(supabase, tenantId, params.cycleId, "FAILED", { outcome: message });
    await writeDecisionLog(supabase, tenantId, { cycleId: params.cycleId, objectiveId: params.objectiveId, workId: null, stage: "AUTHORIZE", actorType: "SYSTEM", action: "AUTHORIZE_FAILED", reasoningSummary: message, reasonCodes: ["AUTHORITY_ENGINE_ERROR"] });
    throw err;
  }
}
