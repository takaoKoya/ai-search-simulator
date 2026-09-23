# 12 — KEEP / MODIFY / REPLACE / DELETE / MISSING

Per the audit's own rule: **"全部作り直し" (rebuild everything) is prohibited.** This document classifies existing assets so a future migration maximizes reuse. Classification is at the level a human can act on (table groups, modules, screens), not every single column.

## 12.1 Database — by domain group

| Domain group | Tables | Verdict | Why |
|---|---|---|---|
| Tenancy & Users | `tenants`, `memberships`, `is_tenant_member()`, `has_tenant_role()` | **KEEP** | Correct, consistently-applied multi-tenant foundation. Do not touch. |
| Org / AI Employees | `departments`, `agents`, `agent_department_assignments` | **MODIFY** | `agents` needs new columns for Goal/KPI/Budget/Authority-limit to become a real "AI Employee" record (currently PARTIAL — see `04_DOMAIN_MODEL_AUDIT.md`). Keep the table, extend it. |
| Sales Pipeline (leads/opportunities/meetings/proposals/estimates/contracts) | ~15 tables | **KEEP** | Real, tested, internally consistent. This is the system's strongest asset. |
| Projects & Delivery | `projects`, `tasks`, `deliverables`, `initiatives`, `findings`, `delivery_records`, `generated_files`, `file_access_logs` | **KEEP**, with **MODIFY** on `projects.status` | The 4-value `projects.status` enum should be widened (or a separate `lifecycle_stage` column added) to actually back the 12-stage UI stepper that already exists (`11_UI_AUDIT.md` §11.5) — a schema fix, not a rebuild. |
| Growth Loop (Phase 7) | `goals`, `kpis`, `measurement_plans`, `kpi_snapshots`, `anomaly_events`, `reporting_cycles`, `monthly_reports`, `contract_renewals`, `upsell_opportunities` | **KEEP** structure; **MODIFY** `goals`/`kpis` FK | These are well-designed, but `goals`/`kpis` need an additional path to a company-level Goal (currently FK'd to `project_id` only) — see `15_TARGET_ARCHITECTURE.md`. |
| Approvals | `approval_requests`, `approval_policies`, `decision_memories` | **KEEP**, **MODIFY** `approval_policies` | Add a DENY/hard-block tier and per-tenant maker-checker enforcement (currently superuser roles always override — `09_PERMISSION_SECURITY_AUDIT.md` §9.4). |
| Integrations/OAuth | `integration_connections`, `oauth_states` | **KEEP** | Real, well-engineered. Extend to more providers later; don't replace. |
| Scheduling/Cron | `business_calendars`, `sla_policies`, `background_jobs`, `external_action_logs` | **MODIFY** `background_jobs` | Add TTL/stale-lock recovery (`06_EVENT_TRIGGER_SCHEDULER_AUDIT.md` §6.3). Everything else, keep. |
| Workflow/Agent Execution | `workflow_runs`, `workflow_checkpoints(+writes)`, `agent_runs`, `agent_events`, `tool_calls` | **KEEP**, **MODIFY** for cross-graph linkage | Add a higher-level "case ID"/"engagement ID" that survives a record's identity changes (lead→opportunity→contract→project) so one business case's full multi-graph history is queryable as one thing (`05_AGENT_RUNTIME_AUDIT.md` §5.8). |
| Legacy (`users`, `daily_tasks`, `daily_logs`) | 3 tables | **DELETE CANDIDATE** (needs a product decision, not a technical one) | Predate multi-tenancy, unrelated to the AI Company OS domain. Confirm with the product owner whether the YATTORU surface (`/home`, `/task/today`) is still a live product before removing. |

**MISSING (new tables needed, not a rebuild of anything existing)**: `objectives` (company-level OKR), a memory/knowledge store (see `15_TARGET_ARCHITECTURE.md`), a `playbooks`/`rules` table (to finally consume `decision_memories.rule_candidate`), a per-tenant/agent `schedules` table, a cost/budget ledger with a spend ceiling.

## 12.2 Agent Runtime / LangGraph

| Asset | Verdict | Why |
|---|---|---|
| All 18 graph builders (`lib/langgraph/graphs/*.ts`) | **KEEP** | Each is a correct, well-tested, well-verified pipeline for its specific business step. The *content* of these pipelines is real product logic worth preserving. |
| `orchestrator.ts::runBusinessGraph` (dispatcher) | **MODIFY → eventually REPLACE its role, keep its mechanics** | Keep `invokeGraph`'s actual graph-building/dispatch code as-is (it works). What needs to change is what decides to *call* it: today only a human route or one hardcoded `if`. A new Planner/Goal-Engine layer should sit in front of it (see `15_TARGET_ARCHITECTURE.md`) — this is additive, not a rewrite of the dispatcher itself. |
| `checkpointer.ts` (SupabaseCheckpointSaver) | **KEEP** | Real, correct durable-execution infrastructure. |
| `lib/ai/provider.ts` (TemplateProvider) | **KEEP as the default/fallback provider**; **MISSING: a real LLM adapter** | The interface (`AIProvider`) is already the intended seam for a real provider — the doc comment says so. Do not discard TemplateProvider (it's valuable for deterministic tests and a zero-cost tier); add a second implementation alongside it. |
| `decideCriticVerdict` / critic gates | **KEEP** | The regenerate-on-fail pattern is sound; extend the 2 real rule-checkers' pattern to the graphs that currently rely on template self-review. |

## 12.3 API Routes

| Group | Verdict |
|---|---|
| All 48 non-cron routes | **KEEP** |
| 4 cron routes | **KEEP** the code; **MISSING** the scheduler wiring (a config file/dashboard setting, not new code) |
| 8 flagged possibly-dead routes (`10_DATABASE_API_AUDIT.md` §10.6) | **MODIFY or DELETE CANDIDATE** — each needs a product decision: wire up the missing UI caller, or remove. Do not leave silently orphaned. |
| Duplicated response-construction code between `generated-files/[id]/download` and `files/download` | **MODIFY** (extract shared helper) — small, safe refactor. |

## 12.4 UI

| Screen | Verdict |
|---|---|
| AI Office core (department rooms, agent cards, activity feed, timeline, header) | **KEEP** | Genuinely live, well-built, exactly the "visualize the company floor" role the audit brief assigns to it (§26 of the brief). |
| CEO Inbox / CEO Seat | **KEEP** | Real, tenant-wide, context-rich. |
| Lead/Opportunity/Project detail pages | **KEEP** | Live, correct. |
| Project lifecycle stepper | **MODIFY** | Back it with a real DB-driven lifecycle field (see §12.1) so all 12 stages are reachable, not 5. |
| Left Nav "Coming Soon" placeholders (Clients, Tasks, Reports, Organization, Settings) | **MISSING** | These are the natural homes for: a company-wide Executive Cockpit (Reports), the Objective/Goal hierarchy view (Organization), and per-tenant policy/authority configuration (Settings). Build, don't discard the nav slots. |
| WebOps Office (`/webops`) | **KEEP as-is, clearly labeled** | Per the audit brief, AI Office is not a delete candidate and WebOps should not be mistaken for a real backend view — keep it as a separate, honestly-labeled demo/prototype surface, not merged into `/office`. |
| `/`, `/home`, `/task/today` (unrelated YATTORU surfaces) | **DELETE CANDIDATE** (product decision) | Same as the legacy tables in §12.1 — confirm these aren't a live separate product before removing. |

## 12.5 What this table implies for `16_MIGRATION_PLAN.md`

The overwhelming majority of this system is **KEEP**. The path to an autonomous AI Company OS is not a rewrite — it is: (1) add a thin new layer above the existing orchestrator that can decide *when* to call it (Scheduler + Goal Engine), (2) widen a handful of schemas (`agents`, `projects.status`, `approval_policies`) rather than replace them, (3) fill five genuinely missing pieces (Objectives, Memory, Playbooks, Schedules, Cost ledger), and (4) resolve a short, concrete list of orphaned routes/UI. See `16_MIGRATION_PLAN.md` for sequencing.
