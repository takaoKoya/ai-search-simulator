/**
 * Cost Guardrail (spec CHANGE 4/§9/FINAL requirement §18) — the
 * ESTIMATE -> RESERVE -> EXECUTE -> ACTUAL -> RECONCILE/RELEASE cost model.
 * A Cost Reservation failure must block execution; a Cost Guardrail check
 * must run before any Real LLM call (see lib/autonomy/planner.ts).
 *
 * `reserve()` enforces `daily_cost_limit_usd` via an optimistic-concurrency
 * conditional UPDATE against a single per-tenant-per-day `cost_ledgers` row
 * (see the migration for exactly how that stays race-free without a new
 * locking primitive) — this is the "Cost Concurrency" scenario: two
 * simultaneous reserve() calls near the daily limit must resolve to exactly
 * one success. `per_execution_cost_limit_usd`/`per_cycle_cost_limit_usd` are
 * checked too, but only as a best-effort read-then-check (PHASE 1's pilot
 * scope runs at most `max_works_per_cycle` — default 1 — work per cycle, so
 * this narrower race window is an accepted, stated trade-off; only the daily
 * ledger, shared across every concurrent cycle in a tenant, gets the
 * race-hardened treatment).
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { getTenantAutonomySettings } from "@/lib/autonomy/killSwitch";

const MAX_LEDGER_RETRIES = 5;

export type CostDenialReason = "PER_EXECUTION_LIMIT_EXCEEDED" | "PER_CYCLE_LIMIT_EXCEEDED" | "DAILY_LIMIT_EXCEEDED";

export class CostReservationDeniedError extends ValidationError {
  constructor(public readonly reason: CostDenialReason) {
    super(`Cost reservation denied: ${reason}`);
    this.name = "CostReservationDeniedError";
  }
}

export interface ReserveParams {
  cycleId: string;
  workId?: string | null;
  estimatedCostUsd: number;
  now?: Date;
}

export type ReserveResult = { allowed: true; reservationId: string } | { allowed: false; reason: CostDenialReason };

interface CostLedgerRow {
  id: string;
  reserved_total_usd: number;
  reconciled_total_usd: number;
}

function ledgerDateFor(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function getOrCreateLedgerRow(supabase: SupabaseServerClient, tenantId: string, ledgerDate: string): Promise<CostLedgerRow> {
  // Explicit zero defaults (not relied on from the DB column default) so
  // this also works against FakeSupabase, which does not apply SQL defaults.
  await supabase
    .from("cost_ledgers")
    .upsert({ tenant_id: tenantId, ledger_date: ledgerDate, reserved_total_usd: 0, reconciled_total_usd: 0 }, { onConflict: "tenant_id,ledger_date", ignoreDuplicates: true });

  const { data, error } = await supabase.from("cost_ledgers").select("id, reserved_total_usd, reconciled_total_usd").eq("tenant_id", tenantId).eq("ledger_date", ledgerDate).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Failed to create cost_ledgers row");
  return data as CostLedgerRow;
}

/** The one atomic primitive: succeeds only if the row's totals still match what was just read. */
async function updateLedgerIfUnchanged(supabase: SupabaseServerClient, tenantId: string, ledger: CostLedgerRow, next: { reserved: number; reconciled: number }): Promise<boolean> {
  const { data, error } = await supabase
    .from("cost_ledgers")
    .update({ reserved_total_usd: next.reserved, reconciled_total_usd: next.reconciled })
    .eq("id", ledger.id)
    .eq("tenant_id", tenantId)
    .eq("reserved_total_usd", ledger.reserved_total_usd)
    .eq("reconciled_total_usd", ledger.reconciled_total_usd)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function adjustLedgerWithRetry(supabase: SupabaseServerClient, tenantId: string, ledgerDate: string, compute: (row: CostLedgerRow) => { reserved: number; reconciled: number }): Promise<void> {
  for (let attempt = 0; attempt < MAX_LEDGER_RETRIES; attempt += 1) {
    const ledger = await getOrCreateLedgerRow(supabase, tenantId, ledgerDate);
    const next = compute(ledger);
    if (await updateLedgerIfUnchanged(supabase, tenantId, ledger, next)) return;
  }
  throw new Error("costGuardrail: ledger update retry limit exceeded");
}

async function sumCycleCommittedCostUsd(supabase: SupabaseServerClient, tenantId: string, cycleId: string): Promise<number> {
  const { data, error } = await supabase.from("cost_reservations").select("estimated_cost_usd, actual_cost_usd, status").eq("tenant_id", tenantId).eq("cycle_id", cycleId).in("status", ["RESERVED", "RECONCILED"]);
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => {
    const amount = row.status === "RECONCILED" ? ((row.actual_cost_usd as number | null) ?? (row.estimated_cost_usd as number)) : (row.estimated_cost_usd as number);
    return sum + (amount ?? 0);
  }, 0);
}

/**
 * ESTIMATE -> RESERVE. Never throws on a denial — returns {allowed:false,
 * reason} so each caller decides its own next state (e.g. CompanyPlanner
 * escalates the cycle; a future Execution Adapter might instead block just
 * the Work). Callers must never proceed to EXECUTE without checking
 * `allowed` first (spec: "Cost Reservation failure must block execution").
 */
export async function reserve(supabase: SupabaseServerClient, tenantId: string, params: ReserveParams): Promise<ReserveResult> {
  const settings = await getTenantAutonomySettings(supabase, tenantId);
  const now = params.now ?? new Date();

  if (settings?.per_execution_cost_limit_usd != null && params.estimatedCostUsd > settings.per_execution_cost_limit_usd) {
    return { allowed: false, reason: "PER_EXECUTION_LIMIT_EXCEEDED" };
  }

  if (settings?.per_cycle_cost_limit_usd != null) {
    const cycleCommitted = await sumCycleCommittedCostUsd(supabase, tenantId, params.cycleId);
    if (cycleCommitted + params.estimatedCostUsd > settings.per_cycle_cost_limit_usd) {
      return { allowed: false, reason: "PER_CYCLE_LIMIT_EXCEEDED" };
    }
  }

  const dailyLimit = settings?.daily_cost_limit_usd ?? null;
  const ledgerDate = ledgerDateFor(now);

  for (let attempt = 0; attempt < MAX_LEDGER_RETRIES; attempt += 1) {
    const ledger = await getOrCreateLedgerRow(supabase, tenantId, ledgerDate);
    const committed = ledger.reserved_total_usd + ledger.reconciled_total_usd;
    if (dailyLimit != null && committed + params.estimatedCostUsd > dailyLimit) {
      return { allowed: false, reason: "DAILY_LIMIT_EXCEEDED" };
    }

    const ok = await updateLedgerIfUnchanged(supabase, tenantId, ledger, { reserved: ledger.reserved_total_usd + params.estimatedCostUsd, reconciled: ledger.reconciled_total_usd });
    if (!ok) continue; // lost the race against a concurrent reserve() — retry with a fresh read

    const { data: reservationRow, error: insertError } = await supabase
      .from("cost_reservations")
      .insert({ tenant_id: tenantId, cycle_id: params.cycleId, work_id: params.workId ?? null, estimated_cost_usd: params.estimatedCostUsd, status: "RESERVED", reserved_at: now.toISOString() })
      .select("id")
      .single();
    if (insertError || !reservationRow) throw insertError ?? new Error("Failed to create cost_reservations row");

    return { allowed: true, reservationId: reservationRow.id as string };
  }

  throw new Error("costGuardrail.reserve: ledger update retry limit exceeded");
}

async function getReservation(supabase: SupabaseServerClient, tenantId: string, reservationId: string) {
  const { data, error } = await supabase.from("cost_reservations").select("id, status, estimated_cost_usd, reserved_at").eq("id", reservationId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError(`cost_reservations ${reservationId} not found`);
  return data as { id: string; status: string; estimated_cost_usd: number; reserved_at: string };
}

/** ACTUAL -> RECONCILE. The estimate moves out of `reserved_total_usd`; the real cost moves into `reconciled_total_usd` — they can differ. */
export async function reconcile(supabase: SupabaseServerClient, tenantId: string, reservationId: string, actualCostUsd: number): Promise<void> {
  const reservation = await getReservation(supabase, tenantId, reservationId);
  if (reservation.status !== "RESERVED") {
    throw new ValidationError(`Cost reservation ${reservationId} is not RESERVED (status=${reservation.status})`);
  }

  await adjustLedgerWithRetry(supabase, tenantId, ledgerDateFor(new Date(reservation.reserved_at)), (row) => ({
    reserved: row.reserved_total_usd - reservation.estimated_cost_usd,
    reconciled: row.reconciled_total_usd + actualCostUsd,
  }));

  const { error } = await supabase.from("cost_reservations").update({ status: "RECONCILED", actual_cost_usd: actualCostUsd, reconciled_at: new Date().toISOString() }).eq("id", reservationId).eq("tenant_id", tenantId);
  if (error) throw error;
}

/** The call never happened (e.g. Planner short-circuited to NO_ACTION before spending) -> RELEASE, no actual cost recorded. */
export async function release(supabase: SupabaseServerClient, tenantId: string, reservationId: string): Promise<void> {
  const reservation = await getReservation(supabase, tenantId, reservationId);
  if (reservation.status !== "RESERVED") {
    throw new ValidationError(`Cost reservation ${reservationId} is not RESERVED (status=${reservation.status})`);
  }

  await adjustLedgerWithRetry(supabase, tenantId, ledgerDateFor(new Date(reservation.reserved_at)), (row) => ({
    reserved: row.reserved_total_usd - reservation.estimated_cost_usd,
    reconciled: row.reconciled_total_usd,
  }));

  const { error } = await supabase.from("cost_reservations").update({ status: "RELEASED" }).eq("id", reservationId).eq("tenant_id", tenantId);
  if (error) throw error;
}
