# 02 — Schema

All PHASE 1 schema changes are additive: no existing column, table, enum value, or RLS policy is dropped, renamed, or narrowed. Source: `supabase/migrations/20260925000000_ai_company_os_phase1_autonomy_core.sql` (core), `20260926000000_ai_company_os_phase1_cost_ledger.sql` (Cost Guardrail ledger), `20260927000000_ai_company_os_phase1_objective_project_link.sql` (`objectives.project_id`). **These three migrations have not been applied to any live Postgres instance** — this sandbox has no live Supabase connection; see `11_OPERATIONS.md §11.1` for how to apply them.

## 2.1 New tables

| Table | Purpose | Key columns | Lifecycle |
|---|---|---|---|
| `objectives` | Company-level goal, distinct from the existing project-scoped `goals` table | `status` (DRAFT/ACTIVE/AT_RISK/ACHIEVED/PAUSED/CANCELLED), `project_id` (nullable FK, added by the 3rd migration) | Full CRUD |
| `autonomy_cycles` | Trace root for one Observe→...→Supervise pass | `cycle_number`, `parent_cycle_id` (self-FK, chains cycle N→N+1), `status` (RUNNING/COMPLETED/FAILED/ESCALATED), `unique(tenant_id, objective_id, cycle_number)` | System-managed, no delete |
| `objective_observations` | Observer output | `progress`, `expected_progress`, `gap`, `risk_level`, `requires_planning` | Append-only |
| `skill_definitions` | Wraps the 18 existing LangGraph pipelines as "Skills" | `executor_ref` (validated against the `GraphName` TS union at the app layer, not a DB check — adding a graph later needs no migration), `risk_level`, `approval_policy_code`, `enabled` | Full CRUD |
| `plan_proposals` | Planner output | `decision` (NO_ACTION/CREATE_WORK/REPLAN/ESCALATE/WAIT), `proposed_works` (jsonb), `confidence`/`planner_suggested_requires_approval` (audit-only, never read by Authority), `provider_kind` (REAL/MOCK/SIMULATED) | System-managed, no delete |
| `works` | A unit of work toward an Objective — new, separate table, **not** a repurposing of `initiatives` | `status` (9-value state machine, `04_STATE_MACHINE.md`), `authority_decision` (set only by AuthorityEngine), `idempotency_key`, two unique constraints (below) | System-managed, no delete |
| `verifications` | ResultVerifier output | `verdict` (PASS/FAIL/RETRY/ESCALATE), `checks` (jsonb array of named checks) | Append-only |
| `impact_assessments` | ImpactAssessor output | `classification` (DIRECT_KPI_CHANGE/INDIRECT_CONTRIBUTION/NO_MEASURABLE_CHANGE/UNKNOWN), `kpi_id` (nullable) | Append-only |
| `cost_reservations` | ESTIMATE→RESERVE→RECONCILE/RELEASE per LLM/execution call | `status` (RESERVED/RECONCILED/RELEASED/EXPIRED), `estimated_cost_usd`, `actual_cost_usd` | System-managed, no delete |
| `execution_costs` | Per-call provider/model/token detail | `provider`, `model`, `input_tokens`/`output_tokens`, `reservation_id` (FK) | Append-only |
| `decision_logs` | Human-auditable "why" narrative, distinct from raw `agent_events` | `stage` (9-value enum), `actor_type` (SYSTEM/AI/HUMAN), `reasoning_summary`, `reason_codes` | Append-only |
| `tenant_autonomy_settings` | One row per tenant — feature flag, mode, Kill Switch, all Loop Safety limits | `feature_enabled`, `autonomy_mode`, `emergency_stop`, 7 numeric/duration limits (`03_AUTONOMY_RUNTIME.md §3.7`) | 1 row per tenant, admin-only write |
| `cost_ledgers` (2nd migration) | One row per tenant per day — the atomicity primitive behind the daily cost limit | `reserved_total_usd`, `reconciled_total_usd`, `unique(tenant_id, ledger_date)` | System-managed |

## 2.2 Additive columns on existing tables

| Table | New column(s) | Effect on existing rows/queries |
|---|---|---|
| `kpis` | `objective_id` (nullable FK); `project_id` dropped `not null` | Every existing row keeps `project_id` set; no data migration needed. Allows a company-level (objective-scoped, no project) KPI alongside project-scoped ones. |
| `tasks` | `work_id`, `cycle_id` (both nullable FKs) | Existing rows keep both null — a no-op for every existing task query. |
| `workflow_runs`, `agent_events`, `approval_requests` | `cycle_id` (nullable FK) | `null` for every human-triggered row (unaffected); set only for an autonomy-triggered row, giving the whole loop one traceable identifier across tables. |
| `approval_policies` | `hard_deny boolean not null default false` | Every existing policy defaults to `false` — behaves identically to before. `07_AUTHORITY_APPROVAL.md` covers the one place this is read. |
| `objectives` | `project_id` (nullable FK, 3rd migration) | Added after discovering `measurement_graph`/`renewal_graph` require a `projectId` to execute — see `06_SKILL_REGISTRY.md §6.3`. |

## 2.3 Idempotency constraints on `works`

Two real DB unique constraints back the idempotency guarantee (never an application-level check-then-insert as the sole enforcement — see `07_AUTHORITY_APPROVAL.md §7.3`):

- `unique(tenant_id, idempotency_key)` — `idempotency_key` is a deterministic FNV-1a hash of `(tenantId, objectiveId, observationId, skillDefinitionId, cycleId)`, computed by `lib/autonomy/authorityEngine.ts::computeWorkIdempotencyKey()` (same hashing style as the existing `seededScore` helper in `lib/ai/provider.ts` — no new hashing approach introduced).
- `unique(tenant_id, observation_id, skill_definition_id)` — belt-and-suspenders: the same observation can never spawn two Works for the same skill.

`FakeSupabase` (the in-memory test double) does not simulate unique-constraint violations, so `authorityEngine.ts`'s pre-check-then-insert is also the only path the test suite exercises directly; the DB constraint is the real backstop in production.

## 2.4 Backfill (migration sections 14-15)

For every tenant that existed before this migration:

- A `tenant_autonomy_settings` row with `feature_enabled = false`, `autonomy_mode = 'OFF'` — provably identical behavior to pre-PHASE-1 (verified by `lib/autonomy/featureDisabledRegression.test.ts`, `10_SECURITY.md §10.4`).
- A `work_creation` approval policy (`steps: [{"role":"manager"}]`) — used by AuthorityEngine's `APPROVAL` path.
- 18 `skill_definitions` rows, one per existing `GraphName` — the full Registry (`06_SKILL_REGISTRY.md`).

`handle_new_tenant_for_user()` (the tenant-provisioning trigger function) is redefined in full to seed the same three things for every brand-new tenant going forward, per this codebase's established convention of re-defining this function on every migration that extends tenant provisioning.

## 2.5 Row Level Security

Every new table has `is_tenant_member(tenant_id)`-scoped policies (the same security-definer function every existing table's RLS already uses), grouped into three patterns:

| Pattern | Tables | Policies |
|---|---|---|
| Full-lifecycle (member CRUD, admin delete) | `objectives`, `skill_definitions` | select/insert/update by any member; delete by `owner`/`ceo`/`admin` |
| System-managed (member CRUD, no delete) | `autonomy_cycles`, `plan_proposals`, `works`, `cost_reservations` | select/insert/update by any member — cancellation is a status transition, never a row deletion |
| Append-only audit | `objective_observations`, `verifications`, `impact_assessments`, `execution_costs`, `decision_logs` | select/insert only, matching the existing `decision_memories` precedent |
| Settings (admin-gated) | `tenant_autonomy_settings`, `cost_ledgers` | select by any member; insert/update restricted to `owner`/`ceo`/`admin` |

`lib/autonomy/tenantIsolation.test.ts` (`10_SECURITY.md §10.3`) independently re-verifies, at the application layer, that no query in `lib/autonomy/**`/`lib/server/autonomyCockpit.ts` can return or mutate another tenant's row even when an id is known — this RLS layer and that application-layer scoping are two independent controls, not one relying on the other.
