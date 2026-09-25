/**
 * Central State Transition service (spec FINAL CHANGE 3). No other module in
 * lib/autonomy/** writes `autonomy_cycles.status` or `works.status` directly
 * — every transition goes through transitionCycle()/transitionWork() here,
 * which enforces the whitelist in lib/autonomy/types.ts (CYCLE_TRANSITIONS /
 * WORK_TRANSITIONS) and refuses any transition out of a terminal state
 * (spec FINAL CHANGE 4: COMPLETED/FAILED/ESCALATED/DENIED/BLOCKED/CANCELLED
 * are terminal — resuming means a new cycle or an explicit retry, never an
 * implicit reopen).
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import { ValidationError, NotFoundError } from "@/lib/server/errors";
import { CYCLE_TRANSITIONS, WORK_TRANSITIONS, type CycleStatus, type WorkStatus } from "@/lib/autonomy/types";

export class IllegalStateTransitionError extends ValidationError {
  constructor(entity: string, from: string, to: string) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
    this.name = "IllegalStateTransitionError";
  }
}

export async function transitionCycle(
  supabase: SupabaseServerClient,
  tenantId: string,
  cycleId: string,
  toStatus: CycleStatus,
  extra?: { outcome?: string; endedAt?: string }
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from("autonomy_cycles")
    .select("status")
    .eq("id", cycleId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw new NotFoundError(`autonomy_cycles ${cycleId} not found`);

  const fromStatus = current.status as CycleStatus;
  const allowed = CYCLE_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new IllegalStateTransitionError("autonomy_cycles", fromStatus, toStatus);
  }

  const { error: writeError } = await supabase
    .from("autonomy_cycles")
    .update({ status: toStatus, outcome: extra?.outcome ?? null, ended_at: extra?.endedAt ?? (allowed.length === 0 ? undefined : new Date().toISOString()) })
    .eq("id", cycleId)
    .eq("tenant_id", tenantId);
  if (writeError) throw writeError;
}

export async function transitionWork(supabase: SupabaseServerClient, tenantId: string, workId: string, toStatus: WorkStatus): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from("works")
    .select("status")
    .eq("id", workId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw new NotFoundError(`works ${workId} not found`);

  const fromStatus = current.status as WorkStatus;
  const allowed = WORK_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new IllegalStateTransitionError("works", fromStatus, toStatus);
  }

  const { error: writeError } = await supabase.from("works").update({ status: toStatus }).eq("id", workId).eq("tenant_id", tenantId);
  if (writeError) throw writeError;
}
