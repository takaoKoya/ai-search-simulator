/**
 * CompanySupervisor (spec §14) — observes Goal/KPI/Observation/Plan/Work/
 * Execution/Verification/Impact/Cost/Approval state for one cycle and
 * decides COMPLETE / NEXT_CYCLE / WAIT / ESCALATE / BLOCK. It never executes
 * a tool or calls a Skill itself — this is a read-and-decide stage, exactly
 * like ImpactAssessor and ResultVerifier.
 *
 * Cycle Continuation (spec FINAL requirement §15): NEXT_CYCLE and COMPLETE
 * both end *this* cycle (RUNNING -> COMPLETED); NEXT_CYCLE never means
 * "reopen/loop the same cycle row." The genuinely new autonomy_cycles row is
 * created the ordinary way — the *next* ObjectiveObserver pass for this
 * objective naturally chains cycle_number+1 via parent_cycle_id (see
 * lib/autonomy/observer.ts) once this cycle is no longer RUNNING. Supervisor
 * deliberately reads the objective's *pre-cycle* status here (Observer only
 * re-evaluates it against fresh KPI data on its next pass) — that staleness
 * is exactly what makes NEXT_CYCLE meaningful: this cycle's execution may
 * well have moved the KPI, but only the next Observation gets to say so.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import { getTenantAutonomySettings } from "@/lib/autonomy/killSwitch";
import { getObjective } from "@/lib/server/objectives";
import { transitionCycle } from "@/lib/autonomy/stateTransition";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";
import type { ImpactClassification, ObjectiveStatus, PlanDecision, SupervisorDecision, VerificationVerdict, WorkStatus } from "@/lib/autonomy/types";

const IN_PROGRESS_WORK_STATUSES: readonly WorkStatus[] = ["PROPOSED", "AUTHORITY_PENDING", "EXECUTING"];
const NO_ACTION_TAKEN_WORK_STATUSES: readonly WorkStatus[] = ["DENIED", "CANCELLED"];

export interface SupervisorReviewInput {
  objectiveStatus: ObjectiveStatus;
  planDecision: PlanDecision | null;
  replanCount: number;
  maxReplansPerCycle: number;
  workStatuses: WorkStatus[];
  verificationVerdicts: VerificationVerdict[];
}

export interface SupervisorReviewOutput {
  decision: SupervisorDecision;
  reasoning: string;
}

/** Pure decision rule — no DB access, so every branch is directly unit-testable. */
export function reviewCycleOutcome(input: SupervisorReviewInput): SupervisorReviewOutput {
  if (input.planDecision === "REPLAN" && input.replanCount >= input.maxReplansPerCycle) {
    return { decision: "ESCALATE", reasoning: `max_replans_per_cycle (${input.maxReplansPerCycle}) reached for this cycle` };
  }
  if (input.planDecision === null) {
    return { decision: "ESCALATE", reasoning: "No plan_proposals row was found for this cycle" };
  }
  if (input.planDecision === "ESCALATE") {
    return { decision: "ESCALATE", reasoning: "The Planner itself decided ESCALATE" };
  }
  if (input.planDecision === "REPLAN") {
    return { decision: "WAIT", reasoning: "The Planner requested a replan within this cycle" };
  }
  if (input.planDecision === "NO_ACTION" || input.planDecision === "WAIT") {
    return { decision: "COMPLETE", reasoning: `The Planner decided ${input.planDecision}; no execution was needed this cycle` };
  }

  // From here, planDecision === "CREATE_WORK".
  if (input.workStatuses.length === 0) {
    return { decision: "ESCALATE", reasoning: "The Planner decided CREATE_WORK but no Work rows exist for this cycle" };
  }
  if (input.workStatuses.some((s) => IN_PROGRESS_WORK_STATUSES.includes(s))) {
    return { decision: "WAIT", reasoning: "A Work is still pending Authority evaluation, human approval, or execution" };
  }
  if (input.workStatuses.includes("BLOCKED")) {
    return { decision: "BLOCK", reasoning: "A Work is BLOCKED pending a separate human step outside the autonomy runtime" };
  }
  if (input.workStatuses.includes("FAILED")) {
    return { decision: "ESCALATE", reasoning: "A Work's execution FAILED" };
  }
  if (input.workStatuses.every((s) => NO_ACTION_TAKEN_WORK_STATUSES.includes(s))) {
    return { decision: "COMPLETE", reasoning: "Every Work in this cycle was DENIED or CANCELLED; nothing further to do" };
  }

  // Remaining case: every Work is COMPLETED (or a mix of COMPLETED/DENIED/CANCELLED).
  if (input.verificationVerdicts.includes("FAIL") || input.verificationVerdicts.includes("ESCALATE")) {
    return { decision: "ESCALATE", reasoning: "A Verification did not PASS" };
  }
  if (input.verificationVerdicts.includes("RETRY")) {
    return { decision: "WAIT", reasoning: "A Verification requested RETRY" };
  }
  if (input.objectiveStatus === "AT_RISK" || input.objectiveStatus === "DRAFT") {
    return { decision: "NEXT_CYCLE", reasoning: `Objective is still ${input.objectiveStatus} after a verified execution; requesting another cycle` };
  }
  return { decision: "COMPLETE", reasoning: `Objective is ${input.objectiveStatus}; cycle concluded successfully` };
}

async function getLatestPlanDecision(supabase: SupabaseServerClient, tenantId: string, cycleId: string): Promise<PlanDecision | null> {
  const { data, error } = await supabase.from("plan_proposals").select("decision").eq("tenant_id", tenantId).eq("cycle_id", cycleId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data?.decision as PlanDecision | undefined) ?? null;
}

async function countReplanDecisions(supabase: SupabaseServerClient, tenantId: string, cycleId: string): Promise<number> {
  const { data, error } = await supabase.from("plan_proposals").select("id").eq("tenant_id", tenantId).eq("cycle_id", cycleId).eq("decision", "REPLAN");
  if (error) throw error;
  return (data ?? []).length;
}

async function getWorkStatusesForCycle(supabase: SupabaseServerClient, tenantId: string, cycleId: string): Promise<Array<{ id: string; status: WorkStatus }>> {
  const { data, error } = await supabase.from("works").select("id, status").eq("tenant_id", tenantId).eq("cycle_id", cycleId);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; status: WorkStatus }>;
}

async function getLatestVerificationVerdict(supabase: SupabaseServerClient, tenantId: string, workId: string): Promise<VerificationVerdict | null> {
  const { data, error } = await supabase.from("verifications").select("verdict").eq("tenant_id", tenantId).eq("work_id", workId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data?.verdict as VerificationVerdict | undefined) ?? null;
}

/** Not consulted by reviewCycleOutcome (spec: only the objective's own pre-cycle status decides NEXT_CYCLE vs COMPLETE) — exposed here purely so a caller/UI can show "what changed" alongside the decision, without Supervisor re-deriving KPI health itself. */
export async function getImpactClassificationsForCycle(supabase: SupabaseServerClient, tenantId: string, cycleId: string): Promise<ImpactClassification[]> {
  const { data, error } = await supabase.from("impact_assessments").select("classification").eq("tenant_id", tenantId).eq("cycle_id", cycleId);
  if (error) throw error;
  return (data ?? []).map((row) => row.classification as ImpactClassification);
}

export interface ReviewCycleParams {
  cycleId: string;
  objectiveId: string;
  /** Defaults to the real wall clock (transitionCycle's own default) — only ever overridden by tests/backfills that also control ObjectiveObserver's `now`, so `ended_at` stays consistent with the rest of a simulated cycle timeline. */
  now?: Date;
}

export interface ReviewCycleResult {
  decision: SupervisorDecision;
  reasoning: string;
}

/**
 * Reviews one cycle's outcome and decides COMPLETE/NEXT_CYCLE/WAIT/ESCALATE/
 * BLOCK. COMPLETE and NEXT_CYCLE both transition the cycle to COMPLETED;
 * ESCALATE transitions it to ESCALATED. WAIT/BLOCK make no transition at all
 * — the cycle stays RUNNING until something external resolves (a human
 * decision, an in-flight execution finishing), consistent with the "no
 * implicit reopen" terminal-state rule: a RUNNING cycle was never closed, so
 * there is nothing to reopen.
 */
export async function reviewCycle(supabase: SupabaseServerClient, tenantId: string, params: ReviewCycleParams): Promise<ReviewCycleResult> {
  const [settings, objective, planDecision, replanCount, works] = await Promise.all([
    getTenantAutonomySettings(supabase, tenantId),
    getObjective(supabase, tenantId, params.objectiveId),
    getLatestPlanDecision(supabase, tenantId, params.cycleId),
    countReplanDecisions(supabase, tenantId, params.cycleId),
    getWorkStatusesForCycle(supabase, tenantId, params.cycleId),
  ]);

  const verificationVerdicts = (await Promise.all(works.map((w) => getLatestVerificationVerdict(supabase, tenantId, w.id)))).filter((v): v is VerificationVerdict => v != null);

  const { decision, reasoning } = reviewCycleOutcome({
    objectiveStatus: objective.status,
    planDecision,
    replanCount,
    maxReplansPerCycle: settings?.max_replans_per_cycle ?? 1,
    workStatuses: works.map((w) => w.status),
    verificationVerdicts,
  });

  const endedAt = params.now?.toISOString();
  if (decision === "COMPLETE" || decision === "NEXT_CYCLE") {
    await transitionCycle(supabase, tenantId, params.cycleId, "COMPLETED", { outcome: reasoning, endedAt });
  } else if (decision === "ESCALATE") {
    await transitionCycle(supabase, tenantId, params.cycleId, "ESCALATED", { outcome: reasoning, endedAt });
  }
  // WAIT/BLOCK: no cycle transition — see module doc comment.

  await writeDecisionLog(supabase, tenantId, {
    cycleId: params.cycleId,
    objectiveId: params.objectiveId,
    stage: "SUPERVISE",
    actorType: "SYSTEM",
    action: decision,
    reasoningSummary: reasoning,
    reasonCodes: [`SUPERVISOR_${decision}`],
  });

  if (decision === "WAIT" && planDecision === "REPLAN") {
    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "supervisor.replan_requested",
      message: "Supervisorが再計画を要求",
      payload: { objectiveId: params.objectiveId, cycleId: params.cycleId },
    });
  }

  return { decision, reasoning };
}
