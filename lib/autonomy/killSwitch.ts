/**
 * Company-level Kill Switch (spec FINAL CHANGE 10). Called at the top of the
 * objective-observer cron handler, ObjectiveObserver, CompanyPlanner, and the
 * Execution Adapter — every entry point that could start new autonomy work.
 *
 * Known limitation (stated, not hidden): this can only prevent *new*
 * planning/work/execution from starting. It cannot forcibly cancel a
 * runBusinessGraph() invocation already in flight — this codebase has no
 * infrastructure to cancel a running async call server-side. Cooperative
 * cancellation (checking the flag between steps) is out of reach for the
 * existing LangGraph pipelines without modifying them, which PHASE 1
 * explicitly does not do (see docs/ai-company-os-phase1/00_IMPLEMENTATION_PLAN.md).
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";

export class AutonomyStoppedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AutonomyStoppedError";
  }
}

export interface TenantAutonomySettingsRow {
  tenant_id: string;
  feature_enabled: boolean;
  autonomy_mode: "OFF" | "SHADOW" | "ASSISTED" | "ACTIVE";
  emergency_stop: boolean;
  per_execution_cost_limit_usd: number | null;
  per_cycle_cost_limit_usd: number | null;
  daily_cost_limit_usd: number | null;
  max_works_per_cycle: number;
  max_tasks_per_work: number;
  max_cycles_per_objective_per_day: number;
  max_replans_per_cycle: number;
  cooldown_after_execution_minutes: number;
  duplicate_work_window_minutes: number;
  planner_timeout_seconds: number;
  execution_timeout_seconds: number;
}

export async function getTenantAutonomySettings(supabase: SupabaseServerClient, tenantId: string): Promise<TenantAutonomySettingsRow | null> {
  const { data, error } = await supabase.from("tenant_autonomy_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return (data as TenantAutonomySettingsRow | null) ?? null;
}

/**
 * Throws AutonomyStoppedError if this tenant's autonomy runtime must not
 * start new work right now (feature disabled, mode OFF, or emergency_stop).
 * Callers must not catch this and fall back to running anyway.
 */
export async function assertNotStopped(supabase: SupabaseServerClient, tenantId: string): Promise<TenantAutonomySettingsRow> {
  const settings = await getTenantAutonomySettings(supabase, tenantId);
  if (!settings || !settings.feature_enabled) {
    throw new AutonomyStoppedError(`Autonomy is not enabled for tenant ${tenantId}`);
  }
  if (settings.emergency_stop) {
    throw new AutonomyStoppedError(`Emergency stop is active for tenant ${tenantId}`);
  }
  if (settings.autonomy_mode === "OFF") {
    throw new AutonomyStoppedError(`Autonomy mode is OFF for tenant ${tenantId}`);
  }
  return settings;
}
