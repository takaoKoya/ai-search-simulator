# 16 — Migration Strategy

No implementation happens in PHASE 0. This document sequences *how* PHASE 1+ should proceed without breaking the working system audited in `02_EXISTING_FEATURES.md`.

## 16.1 Governing principle: Strangler Pattern, additive-first

Every stage below adds a new table/component alongside existing ones and wires it in as one more *caller* of the existing dispatcher (`orchestrator.ts::runBusinessGraph`), never as a replacement of it. Nothing existing is deleted, rewritten, or has its behavior changed until the new component has been running side-by-side and proven safe. This directly follows from `12_KEEP_MODIFY_REPLACE_DELETE.md`, where the overwhelming majority of the system is KEEP.

## 16.2 Stage 0 — Zero-risk wiring fixes (no schema change, days not weeks)

1. Add a scheduling configuration (Vercel Cron `crons` block or equivalent) for the 4 existing cron routes. This alone turns Scheduling from Level 0 (as-deployed) to Level 2 (`03_AUTONOMY_AUDIT.md`) with **zero new code**.
2. Add TTL/stale-lock recovery to `background_jobs` (`06_EVENT_TRIGGER_SCHEDULER_AUDIT.md` §6.3).
3. Resolve the 8 orphaned routes (`10_DATABASE_API_AUDIT.md` §10.6) — wire a UI caller or explicitly deprecate each one; do not leave them silently dead.
4. Switch `isCronRequestAuthorized()` to a constant-time comparison (`09_PERMISSION_SECURITY_AUDIT.md` §9.10 risk 3).

**Why first**: these are the changes explicitly forbidden during PHASE 0 (config/deployment changes) but require no architectural decision and de-risk nothing else — they should be the very first PHASE 1 pull request, reviewed in isolation.

## 16.3 Stage 1 — Data model foundations (additive migrations only)

1. Add `objectives` (tenant-level Goal/OKR table) and a nullable `objective_id` FK on `goals`, so existing project-scoped goals keep working unchanged while new company-level goals become possible.
2. Widen `projects.status` or add a separate `lifecycle_stage` column so the existing 12-stage UI stepper (`11_UI_AUDIT.md` §11.5) is finally backed by real data — additive, does not change any existing status value.
3. Add authority/budget columns to `agents` (nullable, defaulted) — extends the existing table, breaks nothing reading it today.
4. Add a `require_distinct_approvers`/`hard_deny` field to `approval_policies` (default: current behavior unchanged) — closes `14_ROOT_CAUSE_ANALYSIS.md` Chain 6 without touching existing policy rows.
5. Add a cost-ledger table (per-call/agent/model) alongside the existing `ai_cost_yen` accumulators — do not remove the accumulators, they're used by existing UI.

**Why before any runtime change**: every later stage needs somewhere to read/write; building the schema first, additively, means Stage 2+ can be built and tested against real tables from day one.

## 16.4 Stage 2 — Verifier extraction (refactor, not rewrite)

Extract a distinct `Verifier` interface, seeded with the two existing real rule-checkers (`checkOutreachDraft`, `checkProposalDraft`) as the pattern. Migrate the 5 gate-less graphs and the template-self-review graphs onto it **one at a time**, each behind its own test suite (the project already has 291+ passing vitest tests — extend, don't replace). This is a mechanical, low-risk refactor because it changes *what checks a node calls*, not the graph's node topology or trigger.

## 16.5 Stage 3 — Observer + Planner (the core new capability, built smallest-first)

1. Build the **Observer** as a new, narrow cron route (or a node inside the existing `growth-loop-check` sweep) that only reads: KPI-vs-Goal gap, stuck `workflow_runs` (running > N hours), `approval_requests` past SLA. It writes nothing except a new `observations` table (additive) — no behavior change yet.
2. Build the **Planner** as a consumer of `observations` that decides, using simple deterministic rules first (not an LLM — consistent with the codebase's own reproducibility ethos), which *existing* graph to invoke via the *existing, unchanged* `runBusinessGraph()`. The Planner is just one more caller of the dispatcher, exactly like an API route is today.
3. Ship the Planner **disabled by default per tenant** (a feature flag on `tenants` or a new settings row), so it can be turned on for one pilot tenant before any other tenant is affected.

## 16.6 Stage 4 — Memory + Company Brain (additive, read-only integration first)

1. Add a `company_profile`/`objectives`-adjacent knowledge table (mission, rules, competitors) and a real `context.ts` context-builder that assembles it.
2. Wire the context-builder into 1-2 graphs first (e.g. `sales_hypothesis`, `proposal_draft`) as an *additional* input field, not a replacement of existing inline queries — verify output quality improves before rolling out further.
3. Finish the `decision_memories.rule_candidate` loop (`14_ROOT_CAUSE_ANALYSIS.md` Chain 5): a human "promote to rule" action writing a real, consultable rule row that `lead_discovery_graph`'s exclusion check reads.

## 16.7 Stage 5 — Supervisor + Executive Cockpit

1. Build the Supervisor as a read-only aggregator over existing tables (`workflow_runs`, `agent_runs`, `approval_requests`, the new cost ledger) — no new write path, so it cannot destabilize anything.
2. Build the Executive Cockpit UI in the existing "Reports" nav slot, consuming the Supervisor's aggregation — this is now a straightforward UI build because the underlying company-level data (Stage 1 & 3) finally exists.

## 16.8 What never gets touched

The 18 existing LangGraph pipelines, `orchestrator.ts`'s dispatch mechanism, `checkpointer.ts`, the RLS/tenancy model, and the Gmail/Calendar/PDF connectors are **not modified in any stage above** — every stage builds around them. This is the concrete meaning of "existing assets used to the maximum extent" required by the audit brief.

## 16.9 Rollback safety at every stage

Every schema change above is additive (new table or nullable column) and every new runtime component is either disabled-by-default (Planner) or read-only (Observer, Supervisor) until explicitly enabled per tenant — so any stage can be reverted by a feature-flag flip without a data migration rollback.
