/**
 * Execution Adapter (spec §9/migration order step 9) — the only place
 * autonomy Work reaches the existing, unchanged `runBusinessGraph()`
 * dispatcher. Every one of the 18 existing LangGraph pipelines is treated
 * purely as a "Skill" from here; nothing about their internals is touched.
 *
 * Known limitation, stated rather than hidden (same caveat as the Kill
 * Switch's own): `execution_timeout_seconds` races the *caller* against
 * `runBusinessGraph()` via `Promise.race`-equivalent — if it loses, this
 * function stops waiting and marks the Work FAILED, but the underlying
 * LangGraph invocation (and its `workflow_runs` row) may still be running
 * server-side. This codebase has no infrastructure to forcibly cancel an
 * in-flight async call.
 *
 * PHASE 1 only ever dispatches to the two Skills the pilot vertical slice
 * exercises (`measurement_graph`/`renewal_graph` — see the migration's Skill
 * Registry seed comment); any other `executor_ref` throws a clear "not yet
 * supported" error rather than guessing at that graph's input contract.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { assertNotStopped, getTenantAutonomySettings } from "@/lib/autonomy/killSwitch";
import { transitionWork } from "@/lib/autonomy/stateTransition";
import { getObjective } from "@/lib/server/objectives";
import { resolveAssignee } from "@/lib/autonomy/assigneeResolver";
import { runBusinessGraph, type GraphName } from "@/lib/langgraph/orchestrator";
import type { WorkStatus } from "@/lib/autonomy/types";

const DEFAULT_EXECUTION_TIMEOUT_SECONDS = 300;

interface WorkRow {
  id: string;
  tenant_id: string;
  objective_id: string;
  cycle_id: string;
  skill_definition_id: string | null;
  status: WorkStatus;
}

interface SkillDefinitionRow {
  id: string;
  executor_ref: string;
}

async function getWork(supabase: SupabaseServerClient, tenantId: string, workId: string): Promise<WorkRow> {
  const { data, error } = await supabase.from("works").select("id, tenant_id, objective_id, cycle_id, skill_definition_id, status").eq("id", workId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError(`works ${workId} not found`);
  return data as WorkRow;
}

async function getSkillForExecution(supabase: SupabaseServerClient, tenantId: string, skillId: string): Promise<SkillDefinitionRow> {
  const { data, error } = await supabase.from("skill_definitions").select("id, executor_ref").eq("id", skillId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError(`skill_definitions ${skillId} not found`);
  return data as SkillDefinitionRow;
}

async function getProjectCompanyName(supabase: SupabaseServerClient, tenantId: string, projectId: string): Promise<string> {
  const { data, error } = await supabase.from("projects").select("id, client_id, clients(name)").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  const clients = (data as { clients?: { name?: string } | null } | null)?.clients;
  return clients?.name ?? "クライアント";
}

async function buildGraphInput(supabase: SupabaseServerClient, tenantId: string, executorRef: string, projectId: string | null): Promise<Record<string, unknown>> {
  if (!projectId) {
    throw new ValidationError(`Skill "${executorRef}" requires the Work's objective to be linked to a project (objectives.project_id), but none is set`);
  }
  if (executorRef === "measurement_graph") {
    return { projectId };
  }
  if (executorRef === "renewal_graph") {
    const companyName = await getProjectCompanyName(supabase, tenantId, projectId);
    return { projectId, companyName };
  }
  throw new ValidationError(`Skill executor_ref "${executorRef}" is not yet supported by the PHASE 1 Execution Adapter`);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export type ExecutionOutcome = "COMPLETED" | "FAILED" | "BLOCKED" | "SHADOW_SKIPPED";

export interface ExecutionResult {
  workId: string;
  outcome: ExecutionOutcome;
  workflowRunFinalState?: Record<string, unknown>;
}

async function writeDecisionLog(
  supabase: SupabaseServerClient,
  tenantId: string,
  params: { cycleId: string; objectiveId: string; workId: string; action: string; reasoningSummary?: string; reasonCodes?: string[] }
): Promise<void> {
  const { error } = await supabase.from("decision_logs").insert({
    tenant_id: tenantId,
    cycle_id: params.cycleId,
    objective_id: params.objectiveId,
    work_id: params.workId,
    stage: "EXECUTE",
    actor_type: "SYSTEM",
    action: params.action,
    reasoning_summary: params.reasoningSummary ?? null,
    reason_codes: params.reasonCodes ?? [],
  });
  if (error) throw error;
}

export async function executeWork(supabase: SupabaseServerClient, tenantId: string, params: { workId: string }): Promise<ExecutionResult> {
  await assertNotStopped(supabase, tenantId);

  const work = await getWork(supabase, tenantId, params.workId);
  if (work.status !== "APPROVED") {
    throw new ValidationError(`Work ${work.id} is not APPROVED (status=${work.status}); Execution Adapter cannot run it`);
  }
  if (!work.skill_definition_id) {
    throw new ValidationError(`Work ${work.id} has no skill_definition_id`);
  }

  const settings = await getTenantAutonomySettings(supabase, tenantId);

  // Shadow Mode (spec §16/FINAL requirement §5): observe/plan/decide only —
  // AuthorityEngine's decision on this Work is recorded, but no external
  // execution ever happens. CANCELLED is the closest existing terminal
  // status meaning "this will not run," without implying failure.
  if (settings?.autonomy_mode === "SHADOW") {
    await transitionWork(supabase, tenantId, work.id, "CANCELLED");
    await writeDecisionLog(supabase, tenantId, {
      cycleId: work.cycle_id,
      objectiveId: work.objective_id,
      workId: work.id,
      action: "SHADOW_MODE_SKIPPED",
      reasoningSummary: "Autonomy mode is SHADOW: recorded only, no execution.",
    });
    return { workId: work.id, outcome: "SHADOW_SKIPPED" };
  }

  const skill = await getSkillForExecution(supabase, tenantId, work.skill_definition_id);
  const objective = await getObjective(supabase, tenantId, work.objective_id);
  resolveAssignee(); // PHASE 1: always SYSTEM_ASSIGNEE (lib/autonomy/assigneeResolver.ts) — not yet used for routing.

  await transitionWork(supabase, tenantId, work.id, "EXECUTING");

  const timeoutMs = (settings?.execution_timeout_seconds ?? DEFAULT_EXECUTION_TIMEOUT_SECONDS) * 1000;

  try {
    const input = await buildGraphInput(supabase, tenantId, skill.executor_ref, objective.project_id);
    const finalState = await withTimeout(
      runBusinessGraph({ supabase, tenantId, graphName: skill.executor_ref as GraphName, subjectType: "objective", subjectId: objective.id, cycleId: work.cycle_id, input }),
      timeoutMs
    );

    const graphStatus = finalState.status as string | undefined;
    const outcome: ExecutionOutcome = graphStatus === "completed" ? "COMPLETED" : graphStatus === "waiting_human" ? "BLOCKED" : "FAILED";

    await transitionWork(supabase, tenantId, work.id, outcome === "COMPLETED" ? "COMPLETED" : outcome === "BLOCKED" ? "BLOCKED" : "FAILED");
    await writeDecisionLog(supabase, tenantId, {
      cycleId: work.cycle_id,
      objectiveId: work.objective_id,
      workId: work.id,
      action: outcome,
      reasoningSummary: `runBusinessGraph(${skill.executor_ref}) finished with status=${graphStatus ?? "unknown"}`,
      reasonCodes: [`EXECUTION_${outcome}`],
    });

    return { workId: work.id, outcome, workflowRunFinalState: finalState };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionWork(supabase, tenantId, work.id, "FAILED");
    await writeDecisionLog(supabase, tenantId, { cycleId: work.cycle_id, objectiveId: work.objective_id, workId: work.id, action: "FAILED", reasoningSummary: message, reasonCodes: ["EXECUTION_ERROR"] });
    throw err;
  }
}
