# 01 — Architecture

PHASE 1 adds the first closed **AI Company Autonomy Loop** on top of the existing, unmodified 18-LangGraph business platform. This document is the map; see `00_IMPLEMENTATION_PLAN.md` for the authorized design rationale behind every decision below (the 7 FINAL CHANGEs), and the sibling documents for each subsystem's detail.

## 1.1 The loop

```
Objective ──► Autonomy Cycle (trace root, created first)
                 │
                 ▼
          ObjectiveObserver ──► ObjectiveObservation
                 │                 (requires_planning: bool)
                 ▼
      SkillCandidateResolver ──► candidate Skills (filtered view of skill_definitions)
                 │
                 ▼
          CompanyPlanner ──► PlanProposal { decision, proposedWorks[] }
                 │             NO_ACTION | WAIT | ESCALATE ⇒ cycle ends here (successfully)
                 │             REPLAN ⇒ Supervisor loops back within the same cycle (bounded)
                 ▼ (CREATE_WORK only)
               Work (status=PROPOSED)
                 │
                 ▼
         AuthorityEngine  ◄── approval_policies (incl. hard_deny)
        ┌────────┼────────┐
        ▼        ▼        ▼
      DENY   APPROVAL    AUTO
   (terminal) (existing   (proceed)
             approval_requests
              flow, unchanged)
                 │
                 ▼ (AUTO or human-approved)
         AssigneeResolver ──► SYSTEM_ASSIGNEE (PHASE 1: always)
                 │
                 ▼
         Execution Adapter ──► runBusinessGraph() (UNCHANGED) ──► one of the 18 existing graphs
                 │
                 ▼
            ResultVerifier ──► PASS | FAIL | RETRY | ESCALATE (deterministic DB checks, never self-report)
                 │ (PASS only continues)
                 ▼
           ImpactAssessor ──► DIRECT_KPI_CHANGE | INDIRECT_CONTRIBUTION | NO_MEASURABLE_CHANGE | UNKNOWN
                 │             (never writes kpis.current_value itself — see 03_AUTONOMY_RUNTIME.md §3.6)
                 ▼
         CompanySupervisor ──► COMPLETE | NEXT_CYCLE | WAIT | ESCALATE | BLOCK
                 │
                 ▼ (NEXT_CYCLE)
         next ObjectiveObserver pass creates cycle_number+1, parent_cycle_id chained
```

Every stage is a plain async function taking `(supabase, tenantId, params)` and returning a typed result; `lib/autonomy/cycleRunner.ts::runObjectiveCycle()` is the one place that composes them end-to-end, shared by the cron route and the integration test (see `03_AUTONOMY_RUNTIME.md`).

## 1.2 Seven design guarantees (FINAL CHANGEs), as built

1. **Result ≠ Impact.** `ImpactAssessor` (`lib/autonomy/impactAssessor.ts`) is a distinct stage from `ResultVerifier`; only `DIRECT_KPI_CHANGE` is understood as a KPI change, and even then the module never writes `kpis.current_value` itself (see `03_AUTONOMY_RUNTIME.md §3.6`).
2. **DB is the only Source of Truth.** `lib/server/autonomyCockpit.ts` (the Pilot Cockpit's data layer) is a pure read projection over `autonomy_cycles`/`works`/`decision_logs`/etc. — it introduces no second state store, matching the existing AI Office convention (`lib/server/officeState.ts`).
3. **Centralized state transitions.** `lib/autonomy/stateTransition.ts::transitionCycle()`/`transitionWork()` are the *only* writers of `autonomy_cycles.status`/`works.status`; every other module calls through them (`04_STATE_MACHINE.md`).
4. **True terminal states.** `CYCLE_TRANSITIONS`/`WORK_TRANSITIONS` in `lib/autonomy/types.ts` give every terminal status (`COMPLETED`/`FAILED`/`ESCALATED`/`DENIED`/`BLOCKED`/`CANCELLED`) an empty outgoing list — an implicit reopen is a compile-time-checked empty array, not a convention.
5. **Human intervention trace.** Every stage writes through the one shared `lib/autonomy/decisionLog.ts::writeDecisionLog()`, with `actor_type` (`SYSTEM`/`AI`/`HUMAN`) always explicit at the call site — an approve/reject/pause/resume/cancel/override is always traceable back to a specific human via `lib/server/approvals.ts`.
6. **Planner confidence excluded from Authority by construction.** `AuthorityEngine.evaluateAuthority()`'s input type (`AuthorityEvaluationInput`) has no `confidence` field at all — it is structurally impossible for Authority to read it, not merely convention.
7. **No silent failure.** Every stage's `catch` block transitions the cycle/work (via #3 above) and writes a decision log before rethrowing; `cycleRunner.ts`'s outer `.catch()`s exist only so one objective's failure doesn't abort a whole cron sweep — never to swallow the underlying failure, which is already durably recorded before control reaches that `.catch()`.

## 1.3 Boundary with the existing platform

Nothing about the 18 existing LangGraph pipelines, `lib/langgraph/orchestrator.ts`'s dispatch mechanism, the checkpointer, RLS/tenancy, or the Gmail/Calendar/PDF connectors is modified beyond one additive, optional field:

- `runBusinessGraph({ ..., cycleId? })` (`lib/langgraph/orchestrator.ts`) writes `workflow_runs.cycle_id` when present, `null` otherwise. All 18 existing call sites (none of which pass `cycleId`) are byte-for-byte unaffected.
- `lib/autonomy/executionAdapter.ts` is the *only* autonomy module that calls `runBusinessGraph()`. Every one of the 18 pipelines is addressed purely as a "Skill" (a `skill_definitions.executor_ref` string) from this layer up; PHASE 1 only ever dispatches to two of them (`measurement_graph`, `renewal_graph` — see `06_SKILL_REGISTRY.md`).
- `lib/server/approvals.ts::authorizeDecision()` gained one additive parameter (`hardDeny`) and a short-circuit check *before* the existing `SUPERUSER_ROLES` bypass — the bypass itself is untouched for every other approval type (`07_AUTHORITY_APPROVAL.md`).
- `approval_policies` gained one additive column (`hard_deny boolean default false`) — every existing row defaults to `false`, so every pre-existing approval policy behaves identically to before.

## 1.4 Feature isolation

The entire runtime is gated by one row per tenant, `tenant_autonomy_settings` (`02_SCHEMA.md §2.12`):

- `feature_enabled = false` (the default for every existing tenant, backfilled by the migration, and for every new tenant, seeded by `handle_new_tenant_for_user()`) makes every autonomy entry point throw `AutonomyStoppedError` before touching any new table (`killSwitch.ts::assertNotStopped()` — see `10_SECURITY.md §10.4` for the regression proof).
- `autonomy_mode` (`OFF`/`SHADOW`/`ASSISTED`/`ACTIVE`) further narrows behavior even once enabled — see `03_AUTONOMY_RUNTIME.md §3.7`.
- `emergency_stop` is the Kill Switch — a single boolean a human can flip from the Pilot Cockpit UI without a deploy (`11_OPERATIONS.md §11.4`).

## 1.5 File map

| Concern | File(s) |
|---|---|
| Shared types/schemas/transition whitelists | `lib/autonomy/types.ts` |
| State transition service | `lib/autonomy/stateTransition.ts` |
| Kill Switch | `lib/autonomy/killSwitch.ts` |
| Objectives CRUD | `lib/server/objectives.ts` |
| Observer | `lib/autonomy/observer.ts` |
| Skill Registry filter | `lib/autonomy/skillCandidateResolver.ts` |
| LLM abstraction (Fail-Closed) | `lib/ai/llmProvider.ts`, `lib/ai/anthropicLLMProvider.ts` |
| Planner | `lib/autonomy/planner.ts` |
| Authority + Idempotency | `lib/autonomy/authorityEngine.ts` |
| Assignee resolution | `lib/autonomy/assigneeResolver.ts` |
| Execution Adapter | `lib/autonomy/executionAdapter.ts` |
| Result Verifier | `lib/autonomy/verifier.ts` |
| Impact Assessor | `lib/autonomy/impactAssessor.ts` |
| Cost Guardrail | `lib/autonomy/costGuardrail.ts` |
| Supervisor | `lib/autonomy/supervisor.ts` |
| Decision Log writer | `lib/autonomy/decisionLog.ts` |
| Full-cycle composition | `lib/autonomy/cycleRunner.ts` |
| Scheduler entry point | `app/api/cron/objective-observer/route.ts`, `vercel.json` |
| Pilot Cockpit (read model + UI) | `lib/server/autonomyCockpit.ts`, `components/office/AutonomyPilotPanel.tsx`, `app/office/autonomy/page.tsx` |
| Kill Switch toggle API | `app/api/autonomy/settings/route.ts`, `app/api/autonomy/state/route.ts` |
| Schema | `supabase/migrations/20260925000000_ai_company_os_phase1_autonomy_core.sql`, `20260926000000_ai_company_os_phase1_cost_ledger.sql`, `20260927000000_ai_company_os_phase1_objective_project_link.sql` |
