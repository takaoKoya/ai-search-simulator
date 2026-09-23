/**
 * ObjectiveObserver — "look at the company's state," nothing more. Per the
 * authorized plan, the Observer never creates Work; it only measures
 * progress/gap/risk against an Objective's linked KPI (reusing the existing,
 * already-tested deterministic Growth Loop math in lib/server/measurement.ts
 * — this is not reimplemented here) and decides whether Planning is needed.
 *
 * Also owns creating the `autonomy_cycles` row (the trace root for the whole
 * loop) and enforcing the two Observer-level Loop Safety limits (spec FINAL
 * CHANGE 9): max_cycles_per_objective_per_day and
 * cooldown_after_execution_minutes. Both are soft skips (no cycle created,
 * no error), not failures — a cron sweep should just move on to the next
 * objective.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import { assertNotStopped, type TenantAutonomySettingsRow } from "@/lib/autonomy/killSwitch";
import { getObjective, updateObjectiveStatus, type ObjectiveRow } from "@/lib/server/objectives";
import { transitionCycle } from "@/lib/autonomy/stateTransition";
import { classifyKpiStatus, computeTargetGap, type KpiDirection, type KpiStatus } from "@/lib/server/measurement";
import type { ObjectiveStatus } from "@/lib/autonomy/types";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";

export type ObserverSkipReason = "COOLDOWN" | "MAX_CYCLES_REACHED";

export interface ObjectiveObservationRow {
  id: string;
  tenant_id: string;
  objective_id: string;
  cycle_id: string;
  observed_at: string;
  progress: number | null;
  expected_progress: number | null;
  gap: number | null;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  changed_metrics: unknown[];
  requires_planning: boolean;
  reason_codes: string[];
}

export interface ObserveResult {
  skipped: false;
  cycleId: string;
  cycleNumber: number;
  observation: ObjectiveObservationRow;
}

export interface ObserveSkipped {
  skipped: true;
  reason: ObserverSkipReason;
}

const KPI_STATUS_TO_RISK: Record<KpiStatus, ObjectiveObservationRow["risk_level"]> = {
  ON_TARGET: "LOW",
  NEAR_TARGET: "MEDIUM",
  OFF_TARGET: "HIGH",
  CRITICAL: "CRITICAL",
  NO_DATA: null,
};

const RISK_REQUIRES_PLANNING: Record<Exclude<KpiStatus, "NO_DATA">, boolean> = {
  ON_TARGET: false,
  NEAR_TARGET: true,
  OFF_TARGET: true,
  CRITICAL: true,
};

function computeExpectedProgress(objective: ObjectiveRow, now: Date): number | null {
  if (!objective.start_date || !objective.deadline) return null;
  const start = new Date(objective.start_date).getTime();
  const end = new Date(objective.deadline).getTime();
  if (end <= start) return 1;
  const elapsed = (now.getTime() - start) / (end - start);
  return Math.min(1, Math.max(0, elapsed));
}

async function getLatestCycle(supabase: SupabaseServerClient, tenantId: string, objectiveId: string) {
  const { data, error } = await supabase
    .from("autonomy_cycles")
    .select("id, cycle_number, status, ended_at")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .order("cycle_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; cycle_number: number; status: string; ended_at: string | null } | null;
}

async function countCyclesToday(supabase: SupabaseServerClient, tenantId: string, objectiveId: string, now: Date): Promise<number> {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { data, error } = await supabase
    .from("autonomy_cycles")
    .select("id, started_at")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .not("started_at", "is", null);
  if (error) throw error;
  return (data ?? []).filter((row) => (row.started_at as string) >= startOfDay).length;
}

export async function observeObjective(
  supabase: SupabaseServerClient,
  tenantId: string,
  objectiveId: string,
  now: Date = new Date()
): Promise<ObserveResult | ObserveSkipped> {
  const settings: TenantAutonomySettingsRow = await assertNotStopped(supabase, tenantId);
  const objective = await getObjective(supabase, tenantId, objectiveId);

  const latestCycle = await getLatestCycle(supabase, tenantId, objectiveId);

  if (latestCycle && latestCycle.status !== "RUNNING" && latestCycle.ended_at) {
    const cooldownMs = settings.cooldown_after_execution_minutes * 60_000;
    if (now.getTime() - new Date(latestCycle.ended_at).getTime() < cooldownMs) {
      return { skipped: true, reason: "COOLDOWN" };
    }
  }

  const cyclesToday = await countCyclesToday(supabase, tenantId, objectiveId, now);
  if (cyclesToday >= settings.max_cycles_per_objective_per_day) {
    return { skipped: true, reason: "MAX_CYCLES_REACHED" };
  }

  const cycleNumber = (latestCycle?.cycle_number ?? 0) + 1;
  const { data: cycle, error: cycleError } = await supabase
    .from("autonomy_cycles")
    .insert({
      tenant_id: tenantId,
      objective_id: objectiveId,
      parent_cycle_id: latestCycle?.id ?? null,
      cycle_number: cycleNumber,
      status: "RUNNING",
      triggered_by: "SCHEDULER",
    })
    .select("id")
    .single();
  if (cycleError || !cycle) throw cycleError ?? new Error("Failed to create autonomy_cycles row");
  const cycleId = cycle.id as string;

  try {
    const { data: kpi, error: kpiError } = await supabase
      .from("kpis")
      .select("id, name, current_value, target_value, direction, warning_threshold, critical_threshold")
      .eq("tenant_id", tenantId)
      .eq("objective_id", objectiveId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (kpiError) throw kpiError;

    let observationInsert: Record<string, unknown>;
    if (!kpi) {
      observationInsert = {
        tenant_id: tenantId,
        objective_id: objectiveId,
        cycle_id: cycleId,
        progress: null,
        expected_progress: null,
        gap: null,
        risk_level: null,
        changed_metrics: [],
        requires_planning: false,
        reason_codes: ["NO_KPI_LINKED"],
      };
    } else {
      const direction = (kpi.direction as KpiDirection) ?? "HIGHER_IS_BETTER";
      const status = classifyKpiStatus({
        current: kpi.current_value as number | null,
        target: kpi.target_value as number | null,
        warningThreshold: kpi.warning_threshold as number | null,
        criticalThreshold: kpi.critical_threshold as number | null,
        direction,
      });
      const { targetGap, achievementRatio } = computeTargetGap(kpi.current_value as number | null, kpi.target_value as number | null);
      const requiresPlanning = status === "NO_DATA" ? false : RISK_REQUIRES_PLANNING[status];

      observationInsert = {
        tenant_id: tenantId,
        objective_id: objectiveId,
        cycle_id: cycleId,
        progress: achievementRatio,
        expected_progress: computeExpectedProgress(objective, now),
        gap: targetGap,
        risk_level: KPI_STATUS_TO_RISK[status],
        changed_metrics: [{ kpiId: kpi.id, status }],
        requires_planning: requiresPlanning,
        reason_codes: [`KPI_STATUS_${status}`],
      };

      if (objective.status === "ACTIVE" && (status === "OFF_TARGET" || status === "CRITICAL")) {
        await updateObjectiveStatus(supabase, tenantId, objectiveId, "AT_RISK" as ObjectiveStatus);
        await supabase.from("agent_events").insert({
          tenant_id: tenantId,
          event_type: "objective.at_risk",
          message: `Objective「${objective.title}」がリスク状態に (KPI status: ${status})`,
          payload: { objectiveId, cycleId, kpiStatus: status },
        });
      } else if (objective.status === "AT_RISK" && status === "ON_TARGET") {
        await updateObjectiveStatus(supabase, tenantId, objectiveId, "ACTIVE" as ObjectiveStatus);
      }
    }

    const { data: observation, error: obsError } = await supabase.from("objective_observations").insert(observationInsert).select("*").single();
    if (obsError || !observation) throw obsError ?? new Error("Failed to create objective_observations row");

    await writeDecisionLog(supabase, tenantId, {
      cycleId,
      objectiveId,
      stage: "OBSERVE",
      actorType: "SYSTEM",
      action: "OBSERVATION_RECORDED",
      reasoningSummary: `progress=${observationInsert.progress} gap=${observationInsert.gap} requiresPlanning=${observationInsert.requires_planning}`,
      reasonCodes: observationInsert.reason_codes as string[],
    });

    return { skipped: false, cycleId, cycleNumber, observation: observation as ObjectiveObservationRow };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionCycle(supabase, tenantId, cycleId, "FAILED", { outcome: message });
    await writeDecisionLog(supabase, tenantId, { cycleId, objectiveId, stage: "OBSERVE", actorType: "SYSTEM", action: "OBSERVE_FAILED", reasoningSummary: message, reasonCodes: ["OBSERVER_ERROR"] });
    throw err;
  }
}
