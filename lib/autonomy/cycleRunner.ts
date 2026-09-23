/**
 * Composes the full Observe -> Plan -> Authorize -> (if AUTO) Execute ->
 * Verify -> Assess Impact -> Supervise chain for one Objective's cycle.
 * Shared by the objective-observer cron route and the 2-Cycle Closed Loop
 * integration test, so the pipeline is assembled in exactly one place.
 *
 * Every inner stage already catches its own failures, transitions the
 * cycle/work, and writes a decision_logs row before throwing (spec FINAL
 * CHANGE 7 — no silent failure). The `.catch()`s here exist only so one
 * objective's/Work's failure never aborts the rest of a sweep, mirroring
 * the existing growth-loop-check cron route's per-item try/catch — they
 * never mask the fact that something failed, since that fact is already
 * durably recorded before control ever reaches here.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import { observeObjective } from "@/lib/autonomy/observer";
import { planForCycle, type PlanForCycleParams } from "@/lib/autonomy/planner";
import { createAndAuthorizeWork } from "@/lib/autonomy/authorityEngine";
import { executeWork } from "@/lib/autonomy/executionAdapter";
import { verifyExecution } from "@/lib/autonomy/verifier";
import { assessImpact } from "@/lib/autonomy/impactAssessor";
import { reviewCycle } from "@/lib/autonomy/supervisor";
import { transitionCycle } from "@/lib/autonomy/stateTransition";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";
import { getObjective } from "@/lib/server/objectives";
import type { SupervisorDecision } from "@/lib/autonomy/types";

async function getSkillExecutorRef(supabase: SupabaseServerClient, tenantId: string, skillId: string): Promise<string | null> {
  const { data, error } = await supabase.from("skill_definitions").select("executor_ref").eq("id", skillId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return (data as { executor_ref: string } | null)?.executor_ref ?? null;
}

async function getCycleStatus(supabase: SupabaseServerClient, tenantId: string, cycleId: string): Promise<string> {
  const { data, error } = await supabase.from("autonomy_cycles").select("status").eq("id", cycleId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return (data?.status as string | undefined) ?? "RUNNING";
}

export interface AdvanceApprovedWorkParams {
  workId: string;
  cycleId: string;
  objectiveId: string;
  skillDefinitionId: string;
}

/**
 * Runs Execute -> Verify -> Assess Impact for one already-APPROVED Work.
 * Used both immediately after an AUTO authorization and for a later cron
 * sweep of a Work a human has since approved (PHASE 1 does not wire human
 * approval to trigger execution synchronously — the next scheduler tick
 * picks it up, the same loosely-coupled "cron sweeps for actionable rows"
 * pattern the existing growth-loop-check route already uses).
 */
export async function advanceApprovedWork(supabase: SupabaseServerClient, tenantId: string, params: AdvanceApprovedWorkParams): Promise<void> {
  const execResult = await executeWork(supabase, tenantId, { workId: params.workId }).catch((err) => {
    console.error(`advanceApprovedWork: executeWork failed for work ${params.workId}:`, err);
    return null;
  });
  if (!execResult || execResult.outcome === "SHADOW_SKIPPED") return;

  const [executorRef, objective] = await Promise.all([getSkillExecutorRef(supabase, tenantId, params.skillDefinitionId), getObjective(supabase, tenantId, params.objectiveId)]);
  if (!executorRef) return;

  const verification = await verifyExecution(supabase, tenantId, {
    cycleId: params.cycleId,
    objectiveId: params.objectiveId,
    workId: params.workId,
    skillExecutorRef: executorRef,
    projectId: objective.project_id,
  });

  await assessImpact(supabase, tenantId, {
    cycleId: params.cycleId,
    objectiveId: params.objectiveId,
    workId: params.workId,
    verificationId: verification.verificationId,
    skillExecutorRef: executorRef,
    verdict: verification.verdict,
  });
}

export interface RunObjectiveCycleResult {
  skipped: boolean;
  reason?: string;
  cycleId?: string;
  supervisorDecision?: SupervisorDecision;
}

export interface RunObjectiveCycleOptions {
  now?: Date;
  llmOptions?: PlanForCycleParams["llmOptions"];
}

export async function runObjectiveCycle(supabase: SupabaseServerClient, tenantId: string, objectiveId: string, options: RunObjectiveCycleOptions = {}): Promise<RunObjectiveCycleResult> {
  const { now, llmOptions } = options;
  const observation = await observeObjective(supabase, tenantId, objectiveId, now);
  if (observation.skipped) return { skipped: true, reason: observation.reason };

  const { cycleId, observation: obs } = observation;

  if (!obs.requires_planning) {
    await transitionCycle(supabase, tenantId, cycleId, "COMPLETED", { outcome: "No planning required", endedAt: now?.toISOString() });
    await writeDecisionLog(supabase, tenantId, {
      cycleId,
      objectiveId,
      stage: "SUPERVISE",
      actorType: "SYSTEM",
      action: "COMPLETE",
      reasoningSummary: "Observation did not require planning",
    });
    return { skipped: false, cycleId, supervisorDecision: "COMPLETE" };
  }

  const planResult = await planForCycle(supabase, tenantId, { cycleId, objectiveId, llmOptions }).catch((err) => {
    console.error(`runObjectiveCycle: planForCycle failed for objective ${objectiveId}:`, err);
    return null;
  });
  if (!planResult) return { skipped: false, cycleId };

  if (planResult.proposal.decision === "CREATE_WORK") {
    for (const proposedWork of planResult.proposal.proposedWorks) {
      const workResult = await createAndAuthorizeWork(supabase, tenantId, {
        cycleId,
        objectiveId,
        planProposalId: planResult.planProposalId,
        observationId: obs.id,
        proposedWork,
      }).catch((err) => {
        console.error(`runObjectiveCycle: createAndAuthorizeWork failed for objective ${objectiveId}:`, err);
        return null;
      });
      if (!workResult || workResult.duplicate || workResult.authorityDecision !== "AUTO") continue;

      await advanceApprovedWork(supabase, tenantId, { workId: workResult.workId, cycleId, objectiveId, skillDefinitionId: proposedWork.skillDefinitionId });
    }
  }

  // A stage above may already have transitioned the cycle to FAILED/ESCALATED
  // on its own error path — Supervisor only ever reviews a still-RUNNING cycle.
  if ((await getCycleStatus(supabase, tenantId, cycleId)) !== "RUNNING") {
    return { skipped: false, cycleId };
  }

  const supervisorResult = await reviewCycle(supabase, tenantId, { cycleId, objectiveId, now });
  return { skipped: false, cycleId, supervisorDecision: supervisorResult.decision };
}
