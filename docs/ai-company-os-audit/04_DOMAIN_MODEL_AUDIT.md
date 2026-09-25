# 04 — Domain Model Audit

Source: read-only audit of all 8 files in `supabase/migrations/*.sql` (chronological: `20260722000000_init_schema.sql` through `20260924000000_growth_loop_phase7.sql`). 56 tables total: 3 legacy (pre-tenancy) + 53 AI-Company-OS domain tables. Every `create table`/`alter table` statement was read; nothing below is inferred without a table/column citation.

## 4.1 Table inventory by domain

**Legacy (pre-multi-tenant, untouched)** — `users`, `daily_tasks`, `daily_logs` (user-scoped, not tenant-scoped; unrelated YATTORU product).

**Tenancy & Users** — `tenants(id,name,slug)`; `memberships(tenant_id,user_id,role)`; security-definer helpers `is_tenant_member()`, `has_tenant_role()`.

**Org / AI Employees** — `departments`; `agents(code,name,role,job_title,capabilities jsonb,provider,model,prompt_version,status,current_project_id,current_task_id,is_active)` — 24 seeded agents/tenant; `agent_department_assignments`.

**Sales Pipeline** — `clients`; `leads` (+ discovery-stage columns from Phase 3); `icp_profiles`; `do_not_contact`; `lead_scores`; `lead_sales_hypotheses`; `sales_drafts`; `opportunities`; `sales_conversations`/`sales_messages`; `meetings`; `meeting_action_items`; `proposals`/`estimates` (versioned, immutable once approved); `service_catalog`; `followup_candidates`; `contracts` (+ renewal columns from Phase 7).

**Projects & Delivery** — `projects`; `tasks`; `deliverables`; `initiatives`; `findings` (generic evidence table, reused across research/growth-signal/negotiation types); `project_team_members`; `delivery_packages`; `delivery_records` (Phase 7, explicit human-gated delivery event); `generated_files`; `file_access_logs`.

**Growth Loop / Measurement (Phase 7, all new)** — `goals`; `kpis`; `measurement_plans`; `kpi_snapshots`; `anomaly_events`; `reporting_cycles`; `monthly_reports`; `contract_renewals`; `upsell_opportunities`.

**Approvals** — `approval_requests` (single shared mechanism for every approval type); `approval_policies` (per-tenant, condition-matched routing); `decision_memories` (append-only rejection-reason log).

**Integrations/OAuth** — `integration_connections`; `oauth_states`.

**Scheduling / Cron / Business rules** — `business_calendars`+`business_calendar_holidays`; `sla_policies`; `background_jobs` (distributed lock/last-run bookkeeping — system-internal, no `tenant_id`, RLS with zero policies, service-role only); `external_action_logs`.

**Workflow / Agent Execution / Events** — `workflow_runs`; `workflow_checkpoints`/`workflow_checkpoint_writes` (LangGraph checkpointer backing store); `agent_runs`; `agent_events`; `tool_calls`.

## 4.2 Core domain concept mapping (all 34 concepts)

| # | Concept | Status | Evidence |
|---|---|---|---|
| 1 | Company | **EXISTS** | `tenants(id,name,slug)` |
| 2 | Department | **EXISTS** | `departments(tenant_id,code,name)` |
| 3 | Human User | **EXISTS** | `users` + `memberships(role)` |
| 4 | AI Employee | **PARTIAL** | `agents` has identity/capability/status, but no goal, KPI, budget, or authority-limit columns — an identity+capability record, not an autonomous economic actor |
| 5 | Role | **EXISTS (split)** | `memberships.role` (human RBAC) and `agents.role`/`job_title` (AI) are two separate, unrelated systems |
| 6 | Skill | **PARTIAL** | `agents.capabilities` is a free-text jsonb tag list, not a normalized entity with proficiency/versioning |
| 7 | Tool | **PARTIAL** | `tool_calls` records tool_name/input/output per run, but there is no `tools` registry table — tool identity lives only in code |
| 8 | Connector | **EXISTS (narrow)** | `integration_connections`, Google-only (`check (provider in ('google'))`) |
| 9 | Goal | **PARTIAL** | `goals` exists but FK'd to `project_id` only — no company-level Goal |
| 10 | Objective | **MISSING** | No table; no OKR structure |
| 11 | KPI | **EXISTS (project-scoped)** | `kpis` + `kpi_snapshots`, all tied to `project_id`, never to a company Goal |
| 12 | Project | **EXISTS** | `projects(status: active/ready_for_delivery/completed/delivered)` |
| 13 | Work | **PARTIAL** | Diffused across `tasks`/`initiatives`/`deliverables`; no single "Work" abstraction |
| 14 | Task | **EXISTS** | `tasks(project_id,assigned_agent_id,status,depends_on uuid[])` |
| 15 | Action | **PARTIAL** | `agent_events` + `external_action_logs` log discrete actions; no generic `actions` planning table |
| 16 | Plan | **PARTIAL** | `measurement_plans` is the only literal "plan" table, narrowly scoped to KPI measurement — no agent execution-plan table |
| 17 | Execution | **EXISTS** | `workflow_runs` + `agent_runs` |
| 18 | Result | **PARTIAL** | `agent_runs.output`/`deliverables`/`findings` hold results; no unified Result entity |
| 19 | Verification | **PARTIAL** | `critic_status`/`critic_notes`/`qa_notes` recur across many tables; no standalone `verifications` table |
| 20 | Approval | **EXISTS** | `approval_requests` + `approval_policies` |
| 21 | Permission | **PARTIAL** | Enforced via RLS role checks + `approval_policies.steps`; no explicit fine-grained `permissions` table |
| 22 | Authority | **PARTIAL** | Implicit in `memberships.role` hierarchy + policy thresholds; no explicit per-agent authority-limit column |
| 23 | Budget | **PARTIAL/MISSING** | `opportunities.budget` is the *customer's* BANT budget, not an internal spend cap; no agent/tenant AI-spend budget table anywhere |
| 24 | Trigger | **PARTIAL** | No DB-level trigger/schedule-definition table; cadence lives in route code + `background_jobs` (lock bookkeeping only) |
| 25 | Schedule | **PARTIAL** | `business_calendars`/`sla_policies` define hours/targets, not a job/agent recurrence table |
| 26 | Event | **EXISTS** | `agent_events` — genuinely captures agent-to-agent narration, not just user activity (see `06_EVENT_TRIGGER_SCHEDULER_AUDIT.md` for its consumption pattern, which is display-only) |
| 27 | Memory | **MISSING** (as agent memory) | `decision_memories` exists but is a narrow approval-decision note log, never read pre-generation (see `07_MEMORY_KNOWLEDGE_AUDIT.md`) |
| 28 | Knowledge | **MISSING** | No `knowledge`/embeddings/vector table anywhere |
| 29 | Decision | **PARTIAL** | `decision_memories` covers human approval-decision notes only; AI decision reasoning lives unstructured in `agent_runs.output`/`agent_events.payload` |
| 30 | Learning | **MISSING** | No learning/feedback-loop table; `decision_memories.rule_candidate` is a stalled flag with no downstream rules table |
| 31 | Playbook | **MISSING** | Zero occurrences anywhere in migrations |
| 32 | Cost | **PARTIAL** | `leads.ai_cost_yen`/`opportunities.ai_cost_yen` running totals only; no per-call/per-model/per-agent cost ledger |
| 33 | Evaluation | **PARTIAL** | `measurement_plans.evaluation_method`/`latest_evaluation` covers KPI evaluation only; no general agent-output eval-harness table |
| 34 | Audit Log | **PARTIAL (fragmented)** | Split across `agent_events`, `file_access_logs`, `external_action_logs`, legacy `daily_logs` — functional but no single unified table |

**Summary count: 7 EXISTS, 22 PARTIAL, 5 MISSING (Objective, Memory, Knowledge, Learning, Playbook).**

## 4.3 Tenant-scoping

All 53 domain tables carry `tenant_id not null references tenants(id)`. The only exceptions are intentional and documented in-line: `background_jobs` (system-internal, service-role only) and the 3 legacy tables (predate tenancy, scoped by `user_id`).

## 4.4 RLS pattern

Every table has RLS enabled. The generic pattern (applied via `do $$ ... foreach t in array member_tables ... $$` blocks): SELECT/INSERT/UPDATE via `is_tenant_member(tenant_id)`, DELETE via `has_tenant_role(tenant_id, ['owner','ceo','admin'])`. A handful of tables tighten this further (`approval_requests` update restricted to decision-makers; `decision_memories` append-only; `integration_connections`/`oauth_states` additionally scoped to `user_id = auth.uid()`).

## 4.5 Most consequential finding

**`goals`/`kpis` are structurally project-scoped only.** This single fact is the clearest schema-level evidence that the system currently models "deliver and measure a client's project," not "the AI Company pursuing its own top-level objectives" — it is the domain-model root of why this is not yet a Goal-driven autonomous OS (see `14_ROOT_CAUSE_ANALYSIS.md`).
