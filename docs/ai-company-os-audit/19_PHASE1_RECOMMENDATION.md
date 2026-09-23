# 19 — PHASE 1 Recommendation

This is the concrete, scoped answer to "what should PHASE 1 actually do," distilled from `16_MIGRATION_PLAN.md` and `17_VERTICAL_SLICE_PROPOSAL.md`. PHASE 0 (this audit) recommends PHASE 1 be scoped to exactly the following — not the full target architecture at once.

## 19.1 PHASE 1 scope (recommended)

1. **Stage 0 wiring fixes** (`16_MIGRATION_PLAN.md` §16.2) — scheduler config, `background_jobs` TTL, constant-time cron-secret comparison, resolve the 8 orphaned routes. Zero schema risk, immediately closes R3/R4/R5/R8 from `18_RISK_REGISTER.md`.
2. **Stage 1 data-model additions relevant to the vertical slice only** (`16_MIGRATION_PLAN.md` §16.3, items 1 and 5): the `objectives`/`goals` link and the cost ledger. Defer the `approval_policies` DENY-tier and `agents` authority columns to PHASE 2 unless the pilot tenant specifically needs them.
3. **The Vertical Slice itself** (`17_VERTICAL_SLICE_PROPOSAL.md`): scheduler wiring scoped to one pilot tenant, the minimal Observer filter, the minimal Supervisor alert — proving one project's Growth Loop runs end-to-end without a human starting each step.
4. **Cost ceiling enforcement (R1) before the pilot's scheduler goes live** — this is a hard prerequisite, not optional, per `18_RISK_REGISTER.md` R12.

## 19.2 Explicitly out of scope for PHASE 1

- A general-purpose Planner across all graphs (Stage 3's full version) — the vertical slice's Observer is intentionally a single filter query, not a general planning engine.
- Memory/Company Brain (Stage 4) — no graph in the vertical slice needs it.
- Executive Cockpit UI (Stage 5) — no company-level rollup data exists yet to display.
- Any change to the 18 existing LangGraph pipelines' internal logic, the orchestrator's dispatch mechanism, or the RLS/tenancy model — none of these need to change for PHASE 1's scope, and per `12_KEEP_MODIFY_REPLACE_DELETE.md` they should not be touched without a specific reason.
- Replacing `TemplateProvider` with a real LLM provider — orthogonal to autonomy and introduces its own cost/safety review that should happen separately.

## 19.3 Success criteria for PHASE 1

Exactly the definition of done in `17_VERTICAL_SLICE_PROPOSAL.md` §17.5: one pilot tenant's one project completes a full Observe→Act→Verify→Result→KPI→Next-Work cycle with no human starting the measurement/renewal step, while every other tenant's behavior is completely unchanged (verified by the existing 291+ test suite continuing to pass unmodified, plus new tests for the pilot-only code paths).

## 19.4 Why this scope, and not larger

Every dimension of `03_AUTONOMY_AUDIT.md` currently sits at Level 0-2. Jumping straight to Stage 3-5 of the full migration plan would mean building a Planner, Memory, and Supervisor against a data model (company-level Goals, cost ceilings) that doesn't exist yet, and rolling it out to every tenant before proving it on one. PHASE 1's job is to produce the first real evidence — from production, on one tenant — of what an autonomy loop built on top of this specific codebase actually needs, before committing to the larger build in PHASE 2+.
