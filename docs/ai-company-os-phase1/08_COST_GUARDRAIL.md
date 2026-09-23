# 08 — Cost Guardrail

`lib/autonomy/costGuardrail.ts` — the ESTIMATE → RESERVE → EXECUTE → ACTUAL → RECONCILE/RELEASE model. A Cost Reservation denial must block execution (enforced by every caller checking `.allowed` before proceeding — never assumed).

## 8.1 The five states

```
ESTIMATE   (caller, e.g. Planner, before calling a Real provider)
   ↓
RESERVE    reserve(tenantId, { cycleId, workId?, estimatedCostUsd })
   │          → {allowed:false, reason} on denial — never throws for an ordinary denial,
   │            so the caller decides its own next state (Planner escalates the cycle)
   ↓ allowed
EXECUTE    the real LLM/tool call happens
   ↓
ACTUAL     real cost is known
   ↓
RECONCILE  reconcile(tenantId, reservationId, actualCostUsd)  — status → RECONCILED
   (or, if the call never ends up happening — e.g. Planner short-circuits before spending)
RELEASE    release(tenantId, reservationId)                   — status → RELEASED, no actual cost recorded
```

## 8.2 Three independent limits, checked in order

1. **`per_execution_cost_limit_usd`** — `estimatedCostUsd` alone against this ceiling. Best-effort read-then-check (no concurrency hardening — see §8.4).
2. **`per_cycle_cost_limit_usd`** — sum of this cycle's `RESERVED`+`RECONCILED` `cost_reservations` rows, plus the new estimate, against this ceiling. Also best-effort.
3. **`daily_cost_limit_usd`** — the one limit that *is* concurrency-hardened (§8.3), since it is shared across every concurrent cycle in a tenant, not scoped to one cycle.

Any of the three returns `{ allowed: false, reason }` (`PER_EXECUTION_LIMIT_EXCEEDED` / `PER_CYCLE_LIMIT_EXCEEDED` / `DAILY_LIMIT_EXCEEDED`) without creating a `cost_reservations` row.

## 8.3 Daily ledger — optimistic concurrency, not `SELECT ... FOR UPDATE`

One `cost_ledgers` row per `(tenant_id, ledger_date)` (`02_SCHEMA.md`, 2nd migration). `reserve()`'s retry loop:

```
for up to MAX_LEDGER_RETRIES (5):
  read the ledger row (reserved_total_usd, reconciled_total_usd)
  committed + estimate > dailyLimit?  → return {allowed:false}
  UPDATE cost_ledgers SET reserved_total_usd = <old + estimate>
    WHERE id = :id AND reserved_total_usd = <old> AND reconciled_total_usd = <old>   -- conditional on the exact values just read
  0 rows affected (lost the race to a concurrent reserve())?  → retry from the top
  1 row affected?  → insert the cost_reservations row, return {allowed:true, reservationId}
exhausted retries → throw (a genuine bug/contention pathology, not a normal denial)
```

This is the "Cost Concurrency" guarantee: two simultaneous `reserve()` calls near the daily limit resolve to exactly one success, without a `SELECT ... FOR UPDATE` row lock — Postgres's ordinary MVCC means a conditional `UPDATE ... WHERE <old values>` simply affects 0 rows if another transaction already changed them, which is what the retry loop detects and reacts to. `getOrCreateLedgerRow()` always sets `reserved_total_usd: 0, reconciled_total_usd: 0` explicitly on its upsert (not relied on from the SQL column default) so this also works unmodified against `FakeSupabase`, which does not apply column defaults.

`reconcile()`/`release()` use the same conditional-update retry helper (`adjustLedgerWithRetry`) to move the amount out of `reserved_total_usd` and into `reconciled_total_usd` (or nowhere, for a release).

## 8.4 Accepted scope trade-off

`per_execution_cost_limit_usd`/`per_cycle_cost_limit_usd` get only a best-effort read-then-check, not the same race-hardened treatment as the daily ledger. This is an accepted, stated trade-off for PHASE 1's pilot scope: `max_works_per_cycle` defaults to 1, so at most one Work — and thus at most one reservation — is ever created per cycle in the pilot's actual usage pattern, making the narrower race window immaterial in practice. Only the daily ledger, shared across every concurrent cycle a tenant might run, gets the hardened treatment. Revisit if a later phase widens concurrency per tenant.

## 8.5 Real cost lookup

`cost_reservations` are looked up by `id` **and** `tenant_id` together (`getReservation()`) — a caller from tenant B can never `reconcile()`/`release()` tenant A's reservation by id, even if the id leaks; the tenant-scoped `.maybeSingle()` simply returns `null` → `NotFoundError` (verified directly in `lib/autonomy/tenantIsolation.test.ts`, `10_SECURITY.md §10.3`).

`ESTIMATED_PLANNER_LLM_COST_USD = 0.05` (`lib/autonomy/planner.ts`) is a flat PHASE 1 placeholder used only to exercise this mechanism end-to-end; real per-token/per-model costing against `execution_costs`' `input_tokens`/`output_tokens` columns is a PHASE 2 concern.
