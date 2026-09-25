# 03 — Autonomy Runtime

How `lib/autonomy/cycleRunner.ts::runObjectiveCycle()` composes every stage into one Objective's cycle, and how the scheduler drives it.

## 3.1 Entry point: the cron route

`app/api/cron/objective-observer/route.ts` follows the exact pattern the four pre-existing cron routes already use (`isCronRequestAuthorized()` bearer-secret check, `createServiceRoleClient()`, `runBackgroundJob()`'s overlap lock via `background_jobs`). It is wired into `vercel.json` at `0 * * * *` (hourly) alongside `sla-check`, and exports both `POST` (the real handler) and `GET = POST` (Vercel Cron Jobs invoke via GET with the same bearer header).

Per invocation:

1. Load every tenant with `tenant_autonomy_settings.feature_enabled = true` — the coarse sweep filter. Every other tenant is never touched by this route at all.
2. For each such tenant, log `autonomy.cron_fired`, then for each of that tenant's `ACTIVE`/`AT_RISK` objectives, call `runObjectiveCycle()`.
3. Separately, sweep every `APPROVED` Work for that tenant and call `advanceApprovedWork()` + `reviewCycle()` on each — this is how a Work a human approved *after* a previous cron tick eventually executes (PHASE 1 does not trigger execution synchronously from `decideApproval()`; see §3.5).

Each objective's/Work's failure is caught locally (`console.error` + a `failures` counter) so one bad row never aborts the sweep for the rest of the tenant or for other tenants — this never masks the failure itself, which each stage has already durably written to `decision_logs`/transitioned before that `catch` is ever reached (spec FINAL CHANGE 7).

## 3.2 `runObjectiveCycle()`

```
observeObjective()                                    -- always runs first
  → skipped (COOLDOWN | MAX_CYCLES_REACHED)?  → return, no cycle created
  → requires_planning = false?                → transitionCycle COMPLETED, decision log, return (no Planner call)
  → requires_planning = true:
      planForCycle()                                   -- may itself transition cycle to FAILED/ESCALATED and rethrow;
                                                         -- cycleRunner catches only to continue the sweep, not to hide it
      decision === CREATE_WORK?
        for each proposedWork:
          createAndAuthorizeWork()
            duplicate, or authorityDecision !== AUTO?  → skip (APPROVAL/DENY paths wait for a human or are terminal)
            authorityDecision === AUTO?                → advanceApprovedWork() immediately
      cycle still RUNNING (no stage above already failed/escalated it)?
        reviewCycle()                                  -- Supervisor's final word for this pass
```

## 3.3 Observer (`lib/autonomy/observer.ts`)

Creates the `autonomy_cycles` row (the trace root, chained via `parent_cycle_id` to the previous cycle if one exists) *before* writing its own `objective_observations` row. Enforces the two Observer-level Loop Safety limits as soft, silent skips (no cycle row created, no error — the cron route just moves to the next objective):

- `cooldown_after_execution_minutes` — since the last cycle's `ended_at`.
- `max_cycles_per_objective_per_day` — counted from `started_at >= UTC midnight`.

Reuses the existing, already-tested deterministic Growth Loop math (`lib/server/measurement.ts::classifyKpiStatus`/`computeTargetGap`) rather than reimplementing KPI risk classification. `NO_KPI_LINKED` (no KPI row for the objective) is itself a valid observation with `requires_planning = false` — a company objective with no measurable KPI yet is not an error state.

## 3.4 SkillCandidateResolver (`lib/autonomy/skillCandidateResolver.ts`)

The boundary between the full Skill Registry and the Planner — see `06_SKILL_REGISTRY.md`. Never handed to the Planner as a full-table load; always a bounded (`limit`, default 20), indexed-column query.

## 3.5 Planner (`lib/autonomy/planner.ts`)

See `05_PLANNER.md` for the full contract. Summary: builds a bounded `PlannerInput`, calls the Fail-Closed-selected `LLMProvider`, validates the response against `PlanProposalSchema`, records `plan_proposals`, writes an `actor_type: "AI"` decision log. Never creates a `works` row itself — `CREATE_WORK` only *proposes* `proposedWorks[]`; `AuthorityEngine` (next stage) is what actually creates and authorizes each one.

## 3.6 AuthorityEngine → Execution → Verify → Impact

See `07_AUTHORITY_APPROVAL.md`, `08_COST_GUARDRAIL.md`. Once a Work reaches `AUTO` (or a human approves an `APPROVAL` Work — reusing the existing `approval_requests`/`decideApproval()` flow unchanged, with `type='work_creation'`), `advanceApprovedWork()` runs Execute → Verify → Assess Impact as one unit:

1. **Execute** (`executionAdapter.ts`) — the only place `runBusinessGraph()` is called from the autonomy path. `SHADOW` mode short-circuits here to `CANCELLED`, no execution (§3.7). Maps the graph's final `status` (`completed`/`waiting_human`/anything else) to `COMPLETED`/`BLOCKED`/`FAILED`.
2. **Verify** (`verifier.ts`) — deterministic DB checks only (never the graph's self-reported status): does `kpi_snapshots` actually have a fresh CURRENT row (`measurement_graph`), does `contract_renewals` have a fresh row with a risk level assigned (`renewal_graph`)? `ESCALATE` (not `FAIL`) is reserved for "we don't know how to verify this at all" — no project linked, or an unsupported skill — a scope/configuration gap, not a checked-and-failed business result.
3. **Assess Impact** (`impactAssessor.ts`) — only ever runs on the *verified* result; a `FAIL`/`RETRY`/`ESCALATE` verdict short-circuits to `classification: UNKNOWN` before Impact even looks at KPI data. For `measurement_graph`, compares the two most recent CURRENT `kpi_snapshots` values: a change (or the very first snapshot ever recorded) is `DIRECT_KPI_CHANGE`; no change is `NO_MEASURABLE_CHANGE`. `renewal_graph` is always `INDIRECT_CONTRIBUTION` — it assesses risk, it doesn't itself move a KPI value. **This module never calls `kpis.current_value` update itself** — for `measurement_graph`, that write already happened as part of that graph's own (unchanged) execution, from a verified source; ImpactAssessor's job is to *recognize and record* that fact (one `UPDATE_KPI`-stage decision log stating exactly this), never to duplicate the write.

## 3.7 Autonomy Modes

| Mode | LLM provider | Execution |
|---|---|---|
| `OFF` | Mock allowed (only if no real key present) | `assertNotStopped()` throws before any autonomy code runs — same as `feature_enabled=false` in effect |
| `SHADOW` | Mock allowed | Observer/Planner/Authority run normally; Execution Adapter short-circuits every Work straight to `CANCELLED`, no `runBusinessGraph()` call is ever made |
| `ASSISTED` | Real provider required (Fail-Closed — `05_PLANNER.md §5.4`) | Executes normally; a human still approves any `APPROVAL`-decision Work via the existing flow |
| `ACTIVE` | Real provider required | Executes normally; `AUTO`-decision Works run with no human step at all |

Autonomy Mode does not gate Authority's AUTO/APPROVAL/DENY decision — that is entirely `approval_policies`-driven (`07_AUTHORITY_APPROVAL.md`), independent of mode.

## 3.8 Supervisor (`lib/autonomy/supervisor.ts`)

See `04_STATE_MACHINE.md §4.4` for the exact decision table. Reads the objective's *pre-cycle* status (deliberately stale — only the *next* Observer pass re-evaluates it against fresh KPI data) alongside this cycle's Plan/Work/Verification/Impact rows, and decides `COMPLETE`/`NEXT_CYCLE`/`WAIT`/`ESCALATE`/`BLOCK`. `COMPLETE` and `NEXT_CYCLE` both transition the cycle to `COMPLETED` — neither reopens or reuses the current cycle row; the actual next `autonomy_cycles` row (`cycle_number+1`, chained via `parent_cycle_id`) is created the ordinary way by the *next* Observer pass once this cycle is no longer `RUNNING` (`09_VERTICAL_SLICE.md` demonstrates this concretely across two cycles).
