# 17 — Recommended First Vertical Slice

## 17.1 The key finding this proposal is built on

The Growth Loop (Phase 7 — `measurement_graph` → `renewal_graph`/upsell detection → approval → on approval, a **new** `leads`+`opportunities` row is created, closing the loop back into the sales pipeline) is **already, structurally, almost the exact end-to-end autonomous loop the audit brief asks for in §34**: Goal(KPI target) → KPI(kpi_snapshots) → gap detection(anomaly/effect evaluation) → Work(a report/upsell candidate) → Verification(critic+QA) → Result → Approval → **Next Work** (a brand-new sales opportunity, automatically created). The only missing piece is *what starts it* — today, only a human clicking "Measure" or "Renew," or the never-scheduled `growth-loop-check` cron.

**This means the first vertical slice is not a large new build. It is: wire the one missing trigger, add the smallest possible Observer/Planner in front of it, and prove the already-existing loop runs end-to-end without a human starting each step** — turning existing, tested, working code from Level 2 (Task Automation) to Level 3 (Conditional Autonomy) for one narrow case.

## 17.2 The slice, mapped onto the brief's own template

| Brief's template | This slice, using existing assets |
|---|---|
| 1 Goal | An existing `goals` row on one pilot project (already exists — Phase 1 schema) |
| 1 KPI | An existing `kpis` row tied to that goal, already being snapshotted by `measurement_graph` |
| 1 Manager | An existing seeded agent with a manager role (already exists in every tenant's roster) |
| 2-3 AI Employees | The existing `renewal`/`upsell`/`analyst` agents already seeded per tenant (Phase 7) — no new agent identity needed |
| 1 Project | One real, already-`delivered` project in the pilot tenant |
| Work → Tasks | The existing `measurement_plans`/`reporting_cycles` rows `measurement_graph` already creates |
| Tool Execution | The existing `TemplateProvider` calls inside `measurement_graph`/`renewal_graph` (no new tool needed for the slice itself) |
| Verification | The existing critic+QA gate inside `measurement_graph`'s `critic_and_qa_report` node (already real, see `05_AGENT_RUNTIME_AUDIT.md` §5.5) |
| Result | The existing `monthly_reports`/`anomaly_events` rows |
| KPI Update | The existing `kpi_snapshots` writes |
| Supervisor | **NEW, minimal**: a narrow read-only check (see §17.3) |
| Next Work | The existing upsell→new-`leads`+`opportunities` chain (already implemented in `applyApproval` for `upsell_opportunity`) |

## 17.3 What is actually new (kept deliberately tiny)

1. **Scheduler wiring** (Stage 0 of `16_MIGRATION_PLAN.md`): a real cron schedule for `growth-loop-check`, but **scoped to one pilot tenant only** for this slice (a simple tenant allow-list check added to the route, or a separate `growth-loop-check-pilot` route — additive, doesn't change the existing route's behavior for every other tenant).
2. **A minimal Observer**: before invoking `measurement_graph`, check whether this project's KPI is actually due for measurement (reuse the existing `measurement_plans.status` state machine — it already knows PLANNED/WAITING/READY_TO_EVALUATE) rather than blindly sweeping every project every tick. This is a query, not a new architectural layer — the "Observer" for this slice is a single `where measurement_plans.status = 'READY_TO_EVALUATE'` filter.
3. **A minimal Supervisor check**: one new read-only assertion, run after the sweep, that alerts a human (via an existing `agent_events` row, surfaced in the existing Activity Feed — no new UI) if the pilot project's loop did not advance within its expected window. This directly demonstrates the "Supervisor watches Progress/Delay" requirement without building a general Supervisor service yet.

## 17.4 Why this is the right first slice, not a bigger one

- **Every component except the scheduler wiring and the two minimal checks above already exists, is already tested, and is already correct** (per `05_AGENT_RUNTIME_AUDIT.md`'s verification findings on `measurement_graph` specifically — it has one of the *strongest* verification gates in the whole system).
- **It is reversible and scoped to one tenant**: if anything goes wrong, disable the pilot tenant's cron entry; every other tenant is completely unaffected, satisfying the Strangler Pattern requirement.
- **It directly demonstrates the exact loop the audit brief defines as the success criterion** (§38: "without a human instructing every time, within Goal/KPI/Authority/Budget, observe → plan → act → verify → learn → next action") for one real, already-built business capability (renewal/upsell), rather than a synthetic toy example.
- **It exposes, in production, exactly the gaps `13_GAP_ANALYSIS.md` predicts** — e.g., no cost ceiling yet (fine for one pilot tenant, must be added before wider rollout), no cross-graph case ID yet (worth observing whether it's missed in practice before over-building it) — turning the rest of the roadmap from theoretical to evidence-based.

## 17.5 Definition of done for this slice

A pilot tenant's one project measures its KPI, detects a renewal/upsell signal, drafts the relevant report/opportunity, passes verification, creates a human approval — **all without a human clicking "Measure" or "Renew" first** — and, on that human's approval, a new sales opportunity appears in the pipeline automatically. The only human action in the entire loop is the final approval decision, exactly matching the audit brief's "Human-in-the-loop is maintained, but the system is not silent between instructions."
