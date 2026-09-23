# PHASE 1 — Implementation Plan (awaiting approval; no code written yet)

Status: **PLAN ONLY.** Per the PHASE 1 brief's §41, this document is presented for approval before any implementation begins. Grounded directly in `docs/ai-company-os-audit/*` (PHASE 0) and in the exact existing schema/code conventions verified by re-reading the actual source (cited inline below) — not re-derived from memory.

---

## 1. Existing assets we will reuse (not touch internals of)

| Asset | Reuse as |
|---|---|
| `runBusinessGraph()` / `GraphName` union (`lib/langgraph/orchestrator.ts`) | The unchanged execution mechanism. The new Planner becomes **one more caller** of it, exactly like an API route is today (same pattern as the existing `onboarding_graph → execution_graph` auto-chain at orchestrator.ts:111-120). |
| All 18 LangGraph pipelines | Wrapped as **Skills** via a new registry row per graph (`executor_type='LANGGRAPH'`, `executor_ref=<GraphName>`). Zero changes to any graph file. |
| `workflow_runs` (`subject_type`/`subject_id` polymorphic columns) | Reused as-is: when the Planner triggers a graph for a `works` row, it calls `runBusinessGraph({..., subjectType: "work", subjectId: work.id})` — no new linkage columns needed here. |
| `TemplateProvider` (`lib/ai/provider.ts`) | Stays the provider for all 18 existing graphs, completely untouched. The new `LLMProvider` (§9) is a **separate, additional** interface used only by the new `CompanyPlanner` — it does not replace or wrap `TemplateProvider`. |
| `approval_requests` / `approval_policies` / `decideApproval()` (`lib/server/approvals.ts`) | Reused for Plan-Proposal and Work approvals via a new `type` value, same table, same decision endpoint (`POST /api/approvals/[id]/decide`). |
| `getTenantContext()` / `TenantRole` / RLS helper functions (`is_tenant_member`, `has_tenant_role`) | Every new table uses the **identical** RLS-generation pattern (the `do $$ ... foreach t in array member_tables loop ... $$` block already used in every migration since Phase 1). |
| `background_jobs` / `runBackgroundJob()` | Reused directly for both the new cron route's overlap-lock **and** per-objective Planner concurrency (§33) — just new `job_key` values (`"objective-observer"`, `"planner:<objectiveId>"`), zero new locking infrastructure. |
| `measurement.ts`'s `computeChange`/`classifyKpiStatus`/`evaluateEffect` (`lib/server/measurement.ts`) | Reused directly inside `ObjectiveObserver` for gap/risk computation — this logic already does exactly what an Observer needs to do for a KPI, today, for the Growth Loop. |
| `emitEvent()` / `agent_events` / `lib/office/eventTypes.ts` | Extended additively with new event-type strings (§21); no change to the emission mechanism. |
| `googleGmailConnector.ts` / `googleCalendarConnector.ts`'s pattern (raw `fetch` to the provider's REST API, gated by an env var + connection-state check, falling back to a deterministic mock) | The **template** for the new real `LLMProvider` implementation (§9) — see the explicit design decision there. |
| 291+ existing vitest tests, `lib/testing/fakeSupabase.ts` | Untouched; extended with new test files following the same conventions. |

## 2. New Domains (net-new concepts, confirmed MISSING in PHASE 0)

| New table | Purpose | Key columns |
|---|---|---|
| `objectives` | Company-level Goal (confirmed `MISSING` in `04_DOMAIN_MODEL_AUDIT.md` #10) | `id, tenant_id, title, description, objective_type, target_value, current_value, unit, start_date, deadline, priority, status, owner_type, owner_id, created_by, created_at, updated_at` |
| `objective_observations` | Observer output, one row per observation | `id, tenant_id, objective_id, cycle_id, observed_at, progress, expected_progress, gap, risk_level, changed_metrics jsonb, requires_planning, reason_codes text[], created_at` |
| `plan_proposals` | Planner output | `id, tenant_id, objective_id, cycle_id, observation_id, reasoning_summary, proposed_works jsonb, priority, expected_impact, required_skills text[], estimated_cost, requires_approval, confidence, status, created_at` |
| `skill_definitions` | Skill Registry (wraps existing graphs) | `id, tenant_id, name, description, department, input_schema jsonb, output_schema jsonb, required_tools text[], risk_level, approval_policy_code, estimated_cost_class, executor_type, executor_ref, enabled, created_at, updated_at` |
| `works` | Planner-generated unit of work toward an Objective | `id, tenant_id, objective_id, plan_proposal_id, skill_definition_id, title, description, owner_agent_id, expected_outcome, priority, status, estimated_cost, deadline, idempotency_key, created_at, updated_at` |
| `verifications` | ResultVerifier output | `id, tenant_id, cycle_id, work_id, workflow_run_id, verdict, checks jsonb, created_at` |
| `autonomy_cycles` | One Observe→...→Supervise cycle, for Max-Cycle/Cooldown/traceability | `id, tenant_id, objective_id, cycle_number, started_at, ended_at, outcome, created_at` |
| `execution_costs` | Cost Guardrail ledger (§23) | `id, tenant_id, workflow_run_id, cycle_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, created_at` |
| `decision_logs` | Human-auditable "why" narrative, distinct from raw `agent_events` (§25) | `id, tenant_id, cycle_id, objective_id, stage, reasoning_summary, reason_codes text[], created_at` |
| `tenant_autonomy_settings` | One row per tenant: feature flag + Shadow/Assisted/Active mode + guardrail limits (§10, §23, §26, §27) | `tenant_id (pk), feature_enabled, autonomy_mode, per_execution_cost_limit, per_cycle_cost_limit, daily_cost_limit, max_works_per_cycle, max_tasks_per_work, cooldown_minutes, max_cycles_per_objective, updated_at` |

All ten tables: `tenant_id not null references tenants(id) on delete cascade`, RLS via the existing generic loop, `created_at`/`updated_at` via the existing `set_updated_at()` trigger where mutable — **identical pattern to every existing table**, no new conventions introduced.

## 3. Schema change proposal (additive only — full detail with rationale)

**New tables**: all ten in §2, one new migration file (`supabase/migrations/<next-timestamp>_ai_company_os_phase1_autonomy_core.sql`, following the exact existing filename convention).

**Modified existing tables (additive columns only, no existing column removed/renamed, no existing row invalidated)**:

| Table | Change | Why |
|---|---|---|
| `kpis` | Add nullable `objective_id uuid references objectives(id)`; make `project_id` nullable (currently `not null`) | **Decision flagged for your approval**: rather than building a separate "CompanyKPI" table duplicating `direction`/`warning_threshold`/`critical_threshold`/`source`/`measurement_frequency` (all already added to `kpis` in Phase 7 per `04_DOMAIN_MODEL_AUDIT.md`), we extend the existing `kpis` table to also serve company-level KPIs. This directly follows PHASE 0's own `12_KEEP_MODIFY_REPLACE_DELETE.md` recommendation ("MODIFY `goals`/`kpis` FK") instead of creating a redundant new table. If you'd prefer a fully separate `objective_kpis` table matching your spec's literal column list, say so and we'll do that instead — it's a small change to this plan. |
| `tasks` | Add nullable `work_id uuid references works(id)` | Gives the traceability chain `Task → Work → Objective` required by §13, without touching the existing Task system (§13's own instruction: "既存Task Systemを全面置換しない... 必要なrelationのみAdditiveに追加"). |
| `workflow_runs`, `agent_events`, `approval_requests` | Add nullable `cycle_id uuid references autonomy_cycles(id)` | Resolves PHASE 0's Root Cause #10 (no cross-graph case ID). A human-triggered graph run simply has `cycle_id = null`, completely unaffected. |
| `approval_policies` | Add `hard_deny boolean not null default false` | Implements the DENY tier from §22 / PHASE 0's Root Cause Chain 6, additive default-false so every existing policy row is unaffected. |

## 4. New Services / Components

| Component | File | Responsibility |
|---|---|---|
| `ObjectiveObserver` | `lib/autonomy/observer.ts` | Reads active objectives + KPIs (via `computeChange`/`classifyKpiStatus` from `lib/server/measurement.ts`, reused not duplicated), writes `objective_observations`, decides `requiresPlanning`. Writes nothing else — no Work creation, per §7. |
| `CompanyPlanner` | `lib/autonomy/planner.ts` | Consumes an observation + objective + KPI + existing `works` + `skill_definitions`, calls `LLMProvider.generateStructured()` with a zod schema, validates against Guardrails (§10 below), writes `plan_proposals`. Never executes directly. |
| Skill Registry | `lib/autonomy/skillRegistry.ts` | Lookup/seed helpers over `skill_definitions`; maps `executor_ref` (a `GraphName` string) back to the existing `runBusinessGraph()` call. |
| Execution Adapter | `lib/autonomy/executionAdapter.ts` | Given a `works` row whose Skill has `executor_type='LANGGRAPH'`, calls the **existing, unchanged** `runBusinessGraph()` with `subjectType:"work", subjectId: work.id`. |
| `ResultVerifier` | `lib/autonomy/verifier.ts` | Per-skill deterministic checks (field/schema/count/status/existence/numeric-condition, per §16) run after a `workflow_runs` row completes; writes `verifications`; returns PASS/FAIL/RETRY/ESCALATE. |
| `CompanySupervisor` | `lib/autonomy/supervisor.ts` | Reads objectives/works/verifications for AT_RISK/overdue/failed/repeated-retry/no-progress patterns (§18); decides whether to request a new Planner cycle (respecting `autonomy_cycles`/cooldown/max-cycle guardrails), never executes directly. |
| Cost Guardrail | `lib/autonomy/costGuardrail.ts` | Checks `execution_costs` roll-ups against `tenant_autonomy_settings` limits before allowing an LLM call or a new cycle; on breach, returns STOP+ESCALATE (§23). |
| Decision Log writer | `lib/autonomy/decisionLog.ts` | Writes `decision_logs` rows at each stage transition — reasoning summary + reason codes only, never raw chain-of-thought (§25). |
| Shared types/schemas | `lib/autonomy/types.ts` | Zod schemas for `ObjectiveObservation` and `PlanProposal` (§8-9's required schema validation), plus the `AutonomyMode`/`ObjectiveStatus` TS unions. |

## 5. Adapter design for the existing 18 LangGraphs

No graph file changes. One seed migration/data step inserts one `skill_definitions` row per existing `GraphName` (all 18, for Registry completeness per §11 — cheap, it's just data), with `executor_type='LANGGRAPH'`, `executor_ref=<exact GraphName string>`, and `department`/`risk_level`/`approval_policy_code` filled in from what each graph already implies (e.g. `sales_outreach_prep_graph` → risk `MEDIUM`, links to the existing `sales_send` approval-policy code). `executor_ref` is validated at the application layer against the imported `GraphName` type (zod/TS), **not** a DB foreign key or check constraint — a DB check listing 18 graph names would need editing on every future graph addition, which is worse than the existing pattern of trusting application-level types (consistent with how `approval_policies.conditions`/`steps` jsonb are validated in code, not in SQL, today).

**For PHASE 1's vertical slice specifically, only 2 of the 18 seeded skills are ever actually invoked by the Planner** (`measurement_graph`, `renewal_graph`) — the other 16 exist in the Registry for completeness but are not exercised until a later phase widens the Planner's scope.

## 6. Scheduler connection method

1. Add a new cron route, following the **exact existing pattern** of the 4 current routes: `app/api/cron/objective-observer/route.ts` — `isCronRequestAuthorized()`, service-role client, `runBackgroundJob(supabase, "objective-observer", fn)`.
2. Add a `vercel.json` at the repo root (confirmed absent in PHASE 0 — this is Root Cause #3 in `14_ROOT_CAUSE_ANALYSIS.md`) with a `crons` block scheduling **all 5** cron routes (the 4 existing ones + this new one), closing PHASE 0's single cheapest, highest-value finding as part of this same PHASE.
3. For the pilot, `objective-observer`'s handler filters to tenants where `tenant_autonomy_settings.feature_enabled = true` before doing anything — every other tenant's behavior is provably unchanged (a `where` clause, not a code fork).
4. Dev/test control (§20's requirement): the route also accepts being invoked directly (already true of every cron route today via `CRON_SECRET`), so a developer or an integration test can trigger one observation cycle on demand without waiting for the schedule.

## 7. LLM Provider design

```ts
// lib/ai/llmProvider.ts
export interface LLMProvider {
  readonly id: string;
  generateStructured<T>(params: { schema: z.ZodType<T>; prompt: string; system?: string }): Promise<T>;
  generateText(params: { prompt: string; system?: string }): Promise<string>;
}
```

- **`MockLLMProvider`** (default, always available, zero network calls): deterministic, seeded from the input prompt using the exact same `seededScore`-style hash already used in `lib/ai/provider.ts` and `lib/sales/*` — consistent with this codebase's established reproducibility pattern. This is what every test uses; **no external LLM API is ever called in the test suite**, per §34's explicit requirement.
- **Real provider — design decision flagged for approval**: rather than adding a new SDK dependency (`@anthropic-ai/sdk` or similar), we propose implementing `AnthropicLLMProvider` with a **raw `fetch()` call to the Anthropic Messages API**, mirroring the *exact* existing pattern in `lib/integrations/googleGmailConnector.ts`/`googleCalendarConnector.ts` (both of which deliberately use raw `fetch` against Google's REST endpoints rather than Google's official Node SDK). This adds **zero new dependencies** to `package.json`. If you'd prefer using an official SDK instead, say so and we'll adjust.
- **Selection** (`getLLMProvider()`): returns `MockLLMProvider` unless `ANTHROPIC_API_KEY` is set **and** the acting tenant's `tenant_autonomy_settings.feature_enabled = true` — identical gating shape to `getEmailConnector()`/`getCalendarConnector()`'s existing "real only if configured, else simulated" fallback.
- **Where it's used**: only inside `CompanyPlanner`. The 18 existing graphs keep calling `TemplateProvider` exactly as today — this is a deliberate scope boundary, not an oversight.
- **Schema validation**: `CompanyPlanner` always calls `generateStructured()` with the `PlanProposal` zod schema (`lib/autonomy/types.ts`); a response that fails validation is treated as a Verifier-style FAIL and logged, never silently coerced.
- **Key handling**: `ANTHROPIC_API_KEY` read from `process.env` only, added to `.env.example` as a blank placeholder — never hardcoded, matching every existing secret in this codebase.

## 8. Approval / DENY design

- `approval_policies.hard_deny` (new column, default `false`): when a matched policy has `hard_deny = true`, `decideApproval()`'s policy-matching step (`lib/server/approvalPolicy.ts`) short-circuits **before** any `approval_requests` row is created — the action is rejected outright, logged to `decision_logs`, and returns an error to the caller. This is a hard block, not a routable step.
- `authorizeDecision()` (`lib/server/approvals.ts`) is updated so the existing superuser bypass (`SUPERUSER_ROLES`) **never applies when the matched policy is `hard_deny`** — a `hard_deny` policy cannot be approved by anyone, by design (per PHASE 0 Root Cause Chain 6: "DENY must mean DENY").
- New `approval_requests.type = 'plan_proposal'` and `'work_creation'` values, handled in `applyApproval()`/`applyNonApproval()` alongside the existing 9 types — same function, same pattern, two more `case` branches.
- Scope kept deliberately tight for PHASE 1: the fuller "N distinct approvers must agree" control (also identified in PHASE 0) is **not** built now — flagged as a PHASE 2 candidate, consistent with §40's "don't build everything now" instruction.
- Default policy for the vertical slice: Planner-proposed Work with `estimated_cost` under a small threshold → `AUTO` (existing "no approval row" behavior, unchanged code path); above it, or when `requiresApproval=true` from the Planner itself → routed via a new `plan_proposal` policy code (`manager` step, reusing the existing chain mechanism) → `APPROVAL`.

## 9. Cost Guardrail design

- `tenant_autonomy_settings` holds `per_execution_cost_limit`, `per_cycle_cost_limit`, `daily_cost_limit` (all nullable = no limit, but **the pilot tenant will always have all three set** — an unlimited pilot is not acceptable, per PHASE 0 Risk R12).
- Every `LLMProvider.generateStructured()`/`generateText()` call, once it returns, writes one row to `execution_costs` (provider, model, input/output tokens if the provider reports them — `MockLLMProvider` reports zeroes, `AnthropicLLMProvider` reports real usage from the API response).
- `costGuardrail.ts` exposes `checkBeforeCall(tenantId, cycleId)`: sums today's/this-cycle's `execution_costs` for the tenant and compares against `tenant_autonomy_settings`; if exceeded, returns `{allowed: false, reason}` and the caller (Planner) stops and writes a `SUPERVISOR_REPLAN_REQUESTED`-adjacent escalation event instead of calling the LLM.
- This check runs **before** Stage 3 (Planner) is enabled for any tenant, per PHASE 0's explicit sequencing requirement (Risk R12: cost ceiling must exist before the Planner goes live, not after).

## 10. Pilot Vertical Slice (concrete, using the existing Growth Loop)

Exactly the design already recommended in PHASE 0's `17_VERTICAL_SLICE_PROPOSAL.md`, now made concrete against real table/component names:

1. One pilot tenant, one real `delivered` project, one `objectives` row ("CVR改善" or similar), one `kpis` row (existing table, now `objective_id`-linked) already fed by the existing `measurement_graph`.
2. `objective-observer` cron (scoped to this tenant only) runs `ObjectiveObserver`, which calls `lib/server/measurement.ts`'s existing `computeChange`/`classifyKpiStatus` against the KPI's latest `kpi_snapshots`, writes an `objective_observations` row, sets `requiresPlanning=true` if off-track.
3. `CompanyPlanner` runs (in-process call from the Observer, mirroring the existing `onboarding_graph→execution_graph` in-process auto-chain precedent), selects the seeded `measurement_graph`/`renewal_graph` skills, proposes one `works` row.
4. **Shadow Mode first**: the proposal is recorded (`plan_proposals`, `works` in status `PROPOSED`) but the Execution Adapter does not run it — this alone proves the Observer→Planner half of the loop against real production data with zero risk, before anything executes.
5. Promote to **Assisted Mode**: the same Work now creates an `approval_requests` row; on human approval, the Execution Adapter calls the existing `renewal_graph` via `runBusinessGraph()` unchanged.
6. `ResultVerifier` checks the resulting `workflow_runs`/`kpi_snapshots`/`upsell_opportunities` rows deterministically; writes `verifications`.
7. `CompanySupervisor` reads the objective's status; if still `AT_RISK` and within `max_cycles_per_objective`/cooldown, requests another cycle.
8. Only after this is proven stable in Assisted Mode does **Active Mode** (auto-execute within authority, still human-approved for anything above the AUTO threshold) get enabled for the pilot.

## 11. Migration risk

| Risk | Mitigation |
|---|---|
| New nullable columns on `kpis`/`tasks`/`workflow_runs`/`agent_events`/`approval_requests` could be missed by existing `.select("*")`-style code and cause unexpected nulls downstream | Every sampled route in PHASE 0 (`09_PERMISSION_SECURITY_AUDIT.md` §9.5) explicitly selects named columns, not `*` — grep confirms no `select("*")` pattern is relied upon for these tables; still, run the full existing 291+ test suite unmodified after the migration as the acceptance gate before writing any new code. |
| Making `kpis.project_id` nullable could violate an implicit assumption somewhere that it's always present | Search every reader of `kpis.project_id` (`lib/server/projectRoom.ts`, `measurement.ts`, growth-loop graphs) before merging; add a `not null` check only where genuinely required, not at the column level, if any such assumption is found. |
| Planner/Observer running against real production data for the pilot tenant, even in Shadow Mode, still consumes DB writes and could interact with other Growth Loop automation (e.g. the existing `growth-loop-check` cron) | Shadow Mode explicitly does not execute anything (§10 step 4); the pilot tenant's `objective-observer` and `growth-loop-check` both read the same KPI data but neither writes conflicting state until Assisted/Active Mode is reached, and even then only through the unchanged `runBusinessGraph()` path that already has its own idempotency guards (`measurement_plans`/`contract_renewals` unique constraints, per `06_EVENT_TRIGGER_SCHEDULER_AUDIT.md` §6.3). |
| `vercel.json` addition changes production scheduling behavior for the first time ever in this repo | This is intentional and is itself one of PHASE 0's top recommendations — but flagged explicitly here since it is the one change in this plan that affects **existing** cron routes' runtime behavior (they will finally actually run). Recommend deploying this specific change first, in isolation, and observing one full day of `sla-check`/`followup-check`/`token-refresh`/`growth-loop-check` runs before adding the new `objective-observer` route to the same file. |

## 12. Test Plan

New test files (vitest, `MockLLMProvider` only, following existing `lib/testing/fakeSupabase.ts` conventions — no external API calls, no `Math.random()`):

`lib/autonomy/observer.test.ts` (progress/gap/risk computation, `requiresPlanning` threshold logic) · `lib/server/objectives.test.ts` (CRUD, tenant scoping) · `lib/autonomy/planner.test.ts` (schema validation rejects malformed LLM output; guardrail enforcement: max-works-per-cycle, budget, duplicate-detection via idempotency key) · `lib/autonomy/skillRegistry.test.ts` · `lib/autonomy/executionAdapter.test.ts` (calls the real `runBusinessGraph` against `fakeSupabase`, same pattern as existing graph integration tests) · `lib/autonomy/verifier.test.ts` (PASS/FAIL/RETRY/ESCALATE per skill) · `lib/autonomy/costGuardrail.test.ts` (STOP+ESCALATE on breach) · `lib/autonomy/supervisor.test.ts` (AT_RISK/overdue/failed/repeated-retry/no-progress detection; cooldown/max-cycle enforcement) · `lib/server/approvals.test.ts` additions (hard_deny cannot be superuser-overridden; new `plan_proposal`/`work_creation` types) · idempotency test (same observation never creates two `works` rows) · concurrency test (`runBackgroundJob` prevents two simultaneous Planner runs for one objective) · tenant-isolation tests for every new table (mirroring PHASE 0's own security-audit method: attempt cross-tenant read/write, assert it's blocked by RLS) · Shadow Mode test (Planner proposes, `works` never reaches `EXECUTING`) · full **Closed Loop integration test** (`lib/autonomy/closedLoop.integration.test.ts`): Objective→Observation→Plan→Work(Shadow, then Assisted+approve)→Execution(existing graph)→Verification→KPI update→Supervisor→next-cycle-or-stop, entirely against `fakeSupabase`, no network calls — this is the test that proves §39's Completion Criteria.

Existing 291+ tests: run unmodified after every step (§38's rule), zero expected changes to their output.

## 13. Implementation order (Step 1–20, per your own §37, confirmed against this plan)

1. Re-read PHASE 0 docs (done, this plan is the output)
2. Architecture Decision Record — **recommend**: fold the key decisions flagged in §3/§7/§8 of this plan (kpis-reuse-vs-new-table, fetch-vs-SDK for LLM, hard_deny scope) into a short ADR once you've approved or redirected them, rather than a separate long document
3. `objectives` + `kpis` extension (schema + `lib/server/objectives.ts`)
4. `autonomy_cycles` + `cycle_id` columns (traceability first, before anything generates data worth tracing)
5. `ObjectiveObserver`
6. `LLMProvider` abstraction (Mock first; real provider can follow in the same step or slip to just before Step 8)
7. `skill_definitions` + adapter mapping to existing `GraphName`
8. `CompanyPlanner`
9. `works` + Execution Adapter → existing `runBusinessGraph()`
10. `ResultVerifier`
11. `CompanySupervisor`
12. `objective-observer` cron route + `vercel.json` (all 5 routes)
13. New `eventTypes.ts` entries
14. `approval_policies.hard_deny` + `authorizeDecision()` update + new approval types
15. `tenant_autonomy_settings` + Cost Guardrail
16. Shadow Mode wiring (the mode check that stops the Execution Adapter)
17. Pilot Dashboard (§30 of your spec — minimum, new page, no existing UI touched)
18. Vertical Slice E2E (real pilot tenant, Shadow → Assisted)
19. Security/regression pass (tenant-isolation tests for every new table, full existing suite green)
20. Documentation (update `README.md`/`supabase/ER.md` the same way every prior phase did)

Each step: **IMPLEMENT → TYPECHECK → LINT → TEST → REVIEW → next step**, per your §38 — no batched end-of-phase testing.

## 14. Files expected to change (existing files, additive edits only)

`supabase/migrations/` (one new file, plus the additive columns described in §3 land in that same new migration — no existing migration file is edited) · `lib/server/approvals.ts` (`authorizeDecision`, `applyApproval`/`applyNonApproval` new cases) · `lib/server/approvalPolicy.ts` (`hard_deny` short-circuit) · `lib/office/eventTypes.ts` (additive entries) · `components/office/LeftNav.tsx` (one new nav item, feature-flag-gated) · `.env.example` (new blank placeholders: `ANTHROPIC_API_KEY`, `AUTONOMY_LLM_PROVIDER`) · `vercel.json` (new file, or edited if one is added earlier) · `README.md`, `supabase/ER.md` (Step 20).

## 15. Files expected to be new

`supabase/migrations/<ts>_ai_company_os_phase1_autonomy_core.sql` · `lib/server/objectives.ts` · `lib/autonomy/{observer,planner,skillRegistry,executionAdapter,verifier,supervisor,costGuardrail,decisionLog,types}.ts` (+ matching `.test.ts` for each) · `lib/autonomy/closedLoop.integration.test.ts` · `lib/ai/llmProvider.ts`, `lib/ai/anthropicLLMProvider.ts` · `app/api/cron/objective-observer/route.ts` · `app/api/objectives/route.ts`, `app/api/objectives/[id]/route.ts` · `app/api/autonomy/plan-proposals/[id]/decide/route.ts` (or: reuse the existing `/api/approvals/[id]/decide` route as-is and skip this file entirely — **flagged as an open choice**, see below) · `components/office/AutonomyPilotPanel.tsx` · `app/office/autonomy/page.tsx` · `vercel.json`.

**Open choice flagged for your decision**: Plan-proposal/Work approvals can either (a) reuse the existing shared `POST /api/approvals/[id]/decide` route unchanged (simplest, most consistent with "one shared mechanism for every approval type" — my default recommendation), or (b) get a dedicated route. Default to (a) unless you say otherwise — in which case the file list in §15 drops the dedicated route file.

---

## Summary of decisions flagged for your explicit approval before implementation starts

1. **`kpis` table MODIFY vs. new `objective_kpis` table** (§3) — recommend MODIFY (reuse), matching PHASE 0's own recommendation.
2. **Real LLM provider via raw `fetch` (Anthropic Messages API) vs. an official SDK dependency** (§7) — recommend `fetch`, zero new dependencies, matching the Gmail/Calendar connector precedent.
3. **New `works` table vs. repurposing the existing `initiatives` table** (§2) — recommend a new, separate `works` table for PHASE 1 because `initiatives`' current consumers were not fully traced in PHASE 0 and repurposing it carries unverified blast radius; flag `initiatives`↔`works` consolidation as a PHASE 2 spike.
4. **DENY-tier scope**: implement `hard_deny` only in PHASE 1; defer "N distinct approvers must agree" to PHASE 2.
5. **Approval routing for Plan Proposals**: reuse the existing shared decide route (default) rather than a new dedicated one.

Nothing in this plan touches the 18 existing LangGraph pipelines, the orchestrator's dispatch mechanism, the checkpointer, RLS/tenancy, or the Gmail/Calendar/PDF connectors. **Awaiting your approval (or redirection on the 5 flagged decisions above) before writing any code.**
