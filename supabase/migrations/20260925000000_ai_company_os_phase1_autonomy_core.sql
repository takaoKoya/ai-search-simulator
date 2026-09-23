-- AI Company OS: PHASE 1 — Company Core + Autonomy Runtime Foundation
--
-- Establishes the first AI COMPANY AUTONOMY LOOP:
--   Objective -> Autonomy Cycle -> Observation -> Plan -> Authority -> Work
--   -> Execution (existing LangGraph, unchanged) -> Verification
--   -> Impact Assessment -> KPI Update -> Supervisor -> next Cycle
--
-- Design notes (per docs/ai-company-os-phase1/00_IMPLEMENTATION_PLAN.md, v3):
--   * Additive only. No existing column is dropped/renamed, no existing enum
--     value is removed, no existing table is altered destructively.
--   * `kpis` is extended (objective_id, project_id now nullable) rather than
--     creating a parallel "objective_kpis" table — kpis already carries
--     direction/thresholds/source/measurement_frequency from Phase 7.
--   * `works` is a new, separate table — NOT a repurposing of `initiatives`
--     (initiatives' existing consumers were not fully traced; consolidation
--     is a PHASE 2 question, not a PHASE 1 change).
--   * `autonomy_cycles` is the trace root: every downstream row in one
--     Observe->Plan->Authorize->Execute->Verify->Assess->Update->Supervise
--     pass carries the same `cycle_id`. `parent_cycle_id` chains cycle N to
--     cycle N+1 when the Supervisor requests NEXT_CYCLE, so a whole
--     Objective's cycle history is a walkable, auditable chain.
--   * Hard DENY (`approval_policies.hard_deny`) is unconditional: the
--     application-layer change in lib/server/approvals.ts (a separate,
--     non-schema change) removes the superuser-bypass code path entirely
--     for a hard-denied policy match — there is no flag here that a human
--     can flip back; that is by design.
--   * The Planner never writes `works.authority_decision` — only the new
--     AuthorityEngine (application code) does. `plan_proposals.confidence`
--     and `plan_proposals.planner_suggested_requires_approval` are stored
--     for audit/analytics only; no schema or code path lets them influence
--     `works.authority_decision`.
--   * decision_logs is append-only (no update/delete policy), matching the
--     existing `decision_memories` precedent, and is the audit trail that
--     distinguishes AI-made vs human-made decisions (`actor_type`).

-- ============================================================
-- 1. Objectives (Company-level Goal — distinct from the existing
--    project-scoped `goals` table)
-- ============================================================
create table public.objectives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null,
  description text,
  objective_type text not null default 'kpi_target' check (objective_type in ('kpi_target', 'initiative', 'other')),
  target_value numeric,
  current_value numeric,
  unit text,
  start_date date,
  deadline date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'AT_RISK', 'ACHIEVED', 'PAUSED', 'CANCELLED')),
  owner_type text not null default 'agent' check (owner_type in ('agent', 'user')),
  owner_id uuid,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger objectives_set_updated_at before update on public.objectives
  for each row execute function public.set_updated_at();

create index objectives_status_idx on public.objectives (tenant_id, status);

-- ============================================================
-- 2. Autonomy Cycle — the trace root for the whole loop
-- ============================================================
create table public.autonomy_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  objective_id uuid not null references public.objectives (id) on delete cascade,
  parent_cycle_id uuid references public.autonomy_cycles (id),
  cycle_number integer not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'FAILED', 'ESCALATED')),
  triggered_by text not null default 'SCHEDULER' check (triggered_by in ('SCHEDULER', 'MANUAL', 'SUPERVISOR_REPLAN')),
  outcome text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, objective_id, cycle_number)
);

create index autonomy_cycles_objective_idx on public.autonomy_cycles (tenant_id, objective_id, cycle_number desc);

-- ============================================================
-- 3. Objective Observation (Observer output — append-only)
-- ============================================================
create table public.objective_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  objective_id uuid not null references public.objectives (id) on delete cascade,
  cycle_id uuid not null references public.autonomy_cycles (id) on delete cascade,
  observed_at timestamptz not null default now(),
  progress numeric,
  expected_progress numeric,
  gap numeric,
  risk_level text check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  changed_metrics jsonb not null default '[]'::jsonb,
  requires_planning boolean not null default false,
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index objective_observations_cycle_idx on public.objective_observations (tenant_id, cycle_id);

-- ============================================================
-- 4. Skill Registry — wraps the existing 18 LangGraph pipelines as Skills.
--    executor_ref validated at the application layer against the `GraphName`
--    TS union (lib/langgraph/orchestrator.ts) — not a DB check constraint,
--    so adding a future graph never requires a migration here.
-- ============================================================
create table public.skill_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  department text,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  required_tools text[] not null default '{}',
  risk_level text not null default 'MEDIUM' check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  approval_policy_code text,
  estimated_cost_class text not null default 'LOW' check (estimated_cost_class in ('LOW', 'MEDIUM', 'HIGH')),
  executor_type text not null default 'LANGGRAPH' check (executor_type in ('LANGGRAPH')),
  executor_ref text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, executor_ref)
);

create trigger skill_definitions_set_updated_at before update on public.skill_definitions
  for each row execute function public.set_updated_at();

create index skill_definitions_department_idx on public.skill_definitions (tenant_id, department, enabled);

-- ============================================================
-- 5. Plan Proposal (Planner output). `decision` is mandatory — the Planner
--    is not required to create Work every cycle (NO_ACTION/WAIT are valid
--    successful outcomes). `planner_suggested_requires_approval` and
--    `confidence` are advisory/analytics only (see design notes above).
-- ============================================================
create table public.plan_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  objective_id uuid not null references public.objectives (id) on delete cascade,
  cycle_id uuid not null references public.autonomy_cycles (id) on delete cascade,
  observation_id uuid references public.objective_observations (id),
  decision text not null check (decision in ('NO_ACTION', 'CREATE_WORK', 'REPLAN', 'ESCALATE', 'WAIT')),
  reasoning_summary text not null,
  reason_codes text[] not null default '{}',
  proposed_works jsonb not null default '[]'::jsonb,
  expected_impact text,
  candidate_skill_ids uuid[] not null default '{}',
  estimated_cost numeric,
  confidence numeric,
  recommended_next_observation_at timestamptz,
  planner_suggested_requires_approval boolean not null default false,
  provider_kind text not null check (provider_kind in ('REAL', 'MOCK', 'SIMULATED')),
  status text not null default 'RECORDED',
  created_at timestamptz not null default now()
);

create index plan_proposals_cycle_idx on public.plan_proposals (tenant_id, cycle_id);

-- ============================================================
-- 6. Work — "a unit of work toward an Objective". New, separate table
--    (does not repurpose `initiatives`). `authority_decision` is set ONLY
--    by the application-layer AuthorityEngine, never by the Planner.
--    Two unique constraints back Idempotency (spec CHANGE 11) with real DB
--    constraints, not an application check-then-insert.
-- ============================================================
create table public.works (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  objective_id uuid not null references public.objectives (id) on delete cascade,
  plan_proposal_id uuid references public.plan_proposals (id),
  cycle_id uuid not null references public.autonomy_cycles (id) on delete cascade,
  observation_id uuid references public.objective_observations (id),
  skill_definition_id uuid references public.skill_definitions (id),
  title text not null,
  description text,
  assignee_type text not null default 'SYSTEM' check (assignee_type in ('SYSTEM', 'AI_EMPLOYEE')),
  assignee_ref text not null default 'SYSTEM_ASSIGNEE',
  expected_outcome text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'PROPOSED' check (status in (
    'PROPOSED', 'AUTHORITY_PENDING', 'APPROVED', 'DENIED', 'EXECUTING',
    'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'
  )),
  authority_decision text check (authority_decision in ('AUTO', 'APPROVAL', 'DENY')),
  authority_policy_code text,
  estimated_cost numeric,
  deadline timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, observation_id, skill_definition_id)
);

create trigger works_set_updated_at before update on public.works
  for each row execute function public.set_updated_at();

create index works_objective_idx on public.works (tenant_id, objective_id, status);
create index works_cycle_idx on public.works (tenant_id, cycle_id);

-- ============================================================
-- 7. Verification (ResultVerifier output — append-only). Distinct from the
--    executing graph's own self-report: a PASS here is what "Verified
--    Result" means for Impact Assessment / KPI update purposes.
-- ============================================================
create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  cycle_id uuid not null references public.autonomy_cycles (id) on delete cascade,
  work_id uuid not null references public.works (id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs (id),
  verdict text not null check (verdict in ('PASS', 'FAIL', 'RETRY', 'ESCALATE')),
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index verifications_work_idx on public.verifications (tenant_id, work_id);

-- ============================================================
-- 8. Impact Assessment (append-only) — Execution success is NOT the same as
--    KPI change (spec FINAL CHANGE 1). Only a DIRECT_KPI_CHANGE row may
--    trigger a KPI update; the other three classifications explicitly do
--    not, and that is a successful, valid outcome.
-- ============================================================
create table public.impact_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  cycle_id uuid not null references public.autonomy_cycles (id) on delete cascade,
  work_id uuid not null references public.works (id) on delete cascade,
  verification_id uuid references public.verifications (id),
  objective_id uuid not null references public.objectives (id) on delete cascade,
  kpi_id uuid references public.kpis (id),
  classification text not null check (classification in (
    'DIRECT_KPI_CHANGE', 'INDIRECT_CONTRIBUTION', 'NO_MEASURABLE_CHANGE', 'UNKNOWN'
  )),
  rationale text,
  created_at timestamptz not null default now()
);

create index impact_assessments_work_idx on public.impact_assessments (tenant_id, work_id);

-- ============================================================
-- 9. Cost Reservation (Estimate -> Reserve -> Execute -> Actual ->
--    Reconcile/Release). Prevents concurrent-cycle budget overrun; the
--    per-tenant-per-day sum is locked at reservation time by the
--    application layer (costGuardrail.ts), not by a DB-level aggregate
--    constraint (Postgres has no native "sum <= limit" constraint type).
-- ============================================================
create table public.cost_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  cycle_id uuid not null references public.autonomy_cycles (id) on delete cascade,
  work_id uuid references public.works (id),
  estimated_cost_usd numeric not null,
  status text not null default 'RESERVED' check (status in ('RESERVED', 'RECONCILED', 'RELEASED', 'EXPIRED')),
  reserved_at timestamptz not null default now(),
  reconciled_at timestamptz,
  actual_cost_usd numeric,
  created_at timestamptz not null default now()
);

create index cost_reservations_tenant_day_idx on public.cost_reservations (tenant_id, reserved_at);

-- ============================================================
-- 10. Execution Cost ledger (append-only) — per-call provider/model/token
--     detail, reconciled against a cost_reservations row.
-- ============================================================
create table public.execution_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  cycle_id uuid references public.autonomy_cycles (id),
  workflow_run_id uuid references public.workflow_runs (id),
  reservation_id uuid references public.cost_reservations (id),
  provider text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  actual_cost_usd numeric,
  created_at timestamptz not null default now()
);

create index execution_costs_tenant_idx on public.execution_costs (tenant_id, created_at desc);

-- ============================================================
-- 11. Decision Log (append-only) — the human-auditable "why" narrative,
--     distinct from the raw `agent_events` stream. `actor_type`/`actor_id`
--     make it possible to reconstruct, for any decision, whether the
--     system or a specific human made it (spec FINAL CHANGE 5). Never
--     stores chain-of-thought — only summaries and reason codes.
-- ============================================================
create table public.decision_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  cycle_id uuid not null references public.autonomy_cycles (id) on delete cascade,
  objective_id uuid references public.objectives (id),
  work_id uuid references public.works (id),
  stage text not null check (stage in (
    'OBSERVE', 'PLAN', 'AUTHORIZE', 'EXECUTE', 'VERIFY', 'ASSESS_IMPACT',
    'UPDATE_KPI', 'SUPERVISE', 'HUMAN_INTERVENTION'
  )),
  actor_type text not null default 'SYSTEM' check (actor_type in ('SYSTEM', 'AI', 'HUMAN')),
  actor_id uuid,
  action text not null,
  reasoning_summary text,
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index decision_logs_cycle_idx on public.decision_logs (tenant_id, cycle_id, created_at);

-- ============================================================
-- 12. Tenant Autonomy Settings — one row per tenant. Feature flag, Autonomy
--     Mode, Kill Switch, and every Loop Safety limit live here so a single
--     row toggle isolates the whole feature per tenant (spec §26-27, §17,
--     FINAL CHANGE 9/10).
-- ============================================================
create table public.tenant_autonomy_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  feature_enabled boolean not null default false,
  autonomy_mode text not null default 'OFF' check (autonomy_mode in ('OFF', 'SHADOW', 'ASSISTED', 'ACTIVE')),
  emergency_stop boolean not null default false,
  per_execution_cost_limit_usd numeric,
  per_cycle_cost_limit_usd numeric,
  daily_cost_limit_usd numeric,
  max_works_per_cycle integer not null default 1,
  max_tasks_per_work integer not null default 10,
  max_cycles_per_objective_per_day integer not null default 4,
  max_replans_per_cycle integer not null default 1,
  cooldown_after_execution_minutes integer not null default 30,
  duplicate_work_window_minutes integer not null default 60,
  planner_timeout_seconds integer not null default 30,
  execution_timeout_seconds integer not null default 300,
  updated_at timestamptz not null default now()
);

create trigger tenant_autonomy_settings_set_updated_at before update on public.tenant_autonomy_settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- 13. Additive columns on existing tables (no drops, no renames, no
--     destructive enum changes).
-- ============================================================

-- kpis: allow a company-level (objective-scoped, no project) KPI alongside
-- the existing project-scoped ones. project_id is now nullable; every
-- existing row already has it set, so no data migration is needed.
alter table public.kpis add column objective_id uuid references public.objectives (id);
alter table public.kpis alter column project_id drop not null;
create index kpis_objective_idx on public.kpis (tenant_id, objective_id);

-- tasks: additive traceability to Work/Cycle (spec §13). Existing rows keep
-- both columns null, which is a no-op for all existing task queries.
alter table public.tasks add column work_id uuid references public.works (id);
alter table public.tasks add column cycle_id uuid references public.autonomy_cycles (id);

-- workflow_runs / agent_events / approval_requests: additive cycle_id so a
-- human-triggered run/event/approval (cycle_id = null, unaffected) and an
-- autonomy-triggered one (cycle_id set) share one traceable identifier
-- across the whole loop (spec FINAL CHANGE 5 / CHANGE 5 in the v2 plan).
alter table public.workflow_runs add column cycle_id uuid references public.autonomy_cycles (id);
alter table public.agent_events add column cycle_id uuid references public.autonomy_cycles (id);
alter table public.approval_requests add column cycle_id uuid references public.autonomy_cycles (id);

-- approval_policies: Hard DENY tier (spec CHANGE 22/FINAL CHANGE — see
-- lib/server/approvals.ts for the corresponding authorizeDecision() change
-- that makes a hard_deny match unconditionally unreachable by any role,
-- including owner/ceo/admin).
alter table public.approval_policies add column hard_deny boolean not null default false;

-- ============================================================
-- 14. Backfill for existing tenants: default tenant_autonomy_settings row
--     (feature_enabled=false, autonomy_mode='OFF' — provably identical
--     behavior to pre-PHASE-1 for every existing tenant) and a
--     'work_creation' approval policy (used by AuthorityEngine when a
--     Planner-created Work needs human approval).
-- ============================================================
insert into public.tenant_autonomy_settings (tenant_id)
select t.id from public.tenants t
where not exists (select 1 from public.tenant_autonomy_settings s where s.tenant_id = t.id);

insert into public.approval_policies (tenant_id, code, description, conditions, steps)
select t.id, 'work_creation', 'Autonomy Runtime Work承認', '{}'::jsonb, '[{"role":"manager"}]'::jsonb
from public.tenants t
where not exists (select 1 from public.approval_policies p where p.tenant_id = t.id and p.code = 'work_creation');

-- ============================================================
-- 15. Skill Registry backfill: one row per existing GraphName (18 graphs)
--     for every existing tenant. Only measurement_graph/renewal_graph are
--     actually invoked by the PHASE 1 Planner (see the pilot vertical
--     slice) — the rest exist for Registry completeness per spec §11 and
--     are ready for a later phase to widen the Planner's scope onto.
-- ============================================================
insert into public.skill_definitions (tenant_id, name, description, department, executor_ref, risk_level, approval_policy_code)
select t.id, v.name, v.description, v.department, v.executor_ref, v.risk_level, v.approval_policy_code
from public.tenants t
cross join (values
  ('Lead Discovery', 'ICPに基づくリード探索・スコアリング', 'sales', 'lead_discovery_graph', 'LOW', null),
  ('Lead Generation', 'リード調査・戦略立案（レガシー経路）', 'sales', 'lead_generation_graph', 'LOW', null),
  ('Sales Finalize', '受注確定処理', 'sales', 'sales_graph', 'MEDIUM', 'deal_won'),
  ('Sales Draft', '営業提案の骨子作成', 'sales', 'sales_draft_graph', 'LOW', null),
  ('Sales Outreach Prep', '営業文作成・チャネル選定', 'sales', 'sales_outreach_prep_graph', 'MEDIUM', 'sales_send'),
  ('Reply Analysis', '返信分類・返信案作成', 'sales', 'reply_analysis_graph', 'LOW', null),
  ('Meeting Scheduling', '商談候補日時の提示', 'sales', 'meeting_scheduling_graph', 'LOW', null),
  ('Meeting Prep', '商談準備資料の作成', 'sales', 'meeting_prep_graph', 'LOW', null),
  ('Meeting Minutes', '議事録ドラフト作成', 'sales', 'meeting_minutes_graph', 'LOW', null),
  ('Proposal Draft', '提案書・見積ドラフト作成', 'sales', 'proposal_draft_graph', 'MEDIUM', null),
  ('Negotiation Analysis', '交渉論点の整理', 'sales', 'negotiation_analysis_graph', 'MEDIUM', null),
  ('Deal Won Gate', '受注確定前提条件チェック', 'sales', 'deal_won_gate_graph', 'HIGH', 'deal_won'),
  ('Contract Review', '契約書レビュー', 'production', 'contract_graph', 'HIGH', null),
  ('Onboarding', 'プロジェクト立ち上げ', 'production', 'onboarding_graph', 'MEDIUM', null),
  ('Execution', 'タスク実行キュー処理', 'production', 'execution_graph', 'MEDIUM', null),
  ('Delivery', '納品準備', 'production', 'delivery_graph', 'MEDIUM', 'delivery'),
  ('Measurement', 'KPI測定・異常検知・月次レポート', 'production', 'measurement_graph', 'LOW', null),
  ('Renewal', '契約更新リスク・アップセル検知', 'production', 'renewal_graph', 'MEDIUM', null)
) as v(name, description, department, executor_ref, risk_level, approval_policy_code)
where not exists (
  select 1 from public.skill_definitions s where s.tenant_id = t.id and s.executor_ref = v.executor_ref
);

-- ============================================================
-- 16. RLS
-- ============================================================
alter table public.objectives enable row level security;
alter table public.autonomy_cycles enable row level security;
alter table public.objective_observations enable row level security;
alter table public.skill_definitions enable row level security;
alter table public.plan_proposals enable row level security;
alter table public.works enable row level security;
alter table public.verifications enable row level security;
alter table public.impact_assessments enable row level security;
alter table public.cost_reservations enable row level security;
alter table public.execution_costs enable row level security;
alter table public.decision_logs enable row level security;
alter table public.tenant_autonomy_settings enable row level security;

-- 16a. Full-lifecycle tables (select/insert/update by any member, delete by
-- owner/ceo/admin) — same generic pattern used since Phase 1.
do $$
declare
  t text;
  member_tables text[] := array['objectives', 'skill_definitions'];
begin
  foreach t in array member_tables loop
    execute format('create policy "%1$s_select_member" on public.%1$s for select using (public.is_tenant_member(tenant_id));', t);
    execute format('create policy "%1$s_insert_member" on public.%1$s for insert with check (public.is_tenant_member(tenant_id));', t);
    execute format('create policy "%1$s_update_member" on public.%1$s for update using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));', t);
    execute format('create policy "%1$s_delete_admin" on public.%1$s for delete using (public.has_tenant_role(tenant_id, array[''owner'', ''ceo'', ''admin'']));', t);
  end loop;
end $$;

-- 16b. System-managed lifecycle tables (select/insert/update by any member;
-- no delete — these are audit-relevant runtime rows, cancellation is a
-- status transition, not a row deletion).
do $$
declare
  t text;
  system_tables text[] := array['autonomy_cycles', 'plan_proposals', 'works', 'cost_reservations'];
begin
  foreach t in array system_tables loop
    execute format('create policy "%1$s_select_member" on public.%1$s for select using (public.is_tenant_member(tenant_id));', t);
    execute format('create policy "%1$s_insert_member" on public.%1$s for insert with check (public.is_tenant_member(tenant_id));', t);
    execute format('create policy "%1$s_update_member" on public.%1$s for update using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));', t);
  end loop;
end $$;

-- 16c. Append-only audit tables (select/insert only — matches the existing
-- `decision_memories` precedent).
do $$
declare
  t text;
  append_only_tables text[] := array['objective_observations', 'verifications', 'impact_assessments', 'execution_costs', 'decision_logs'];
begin
  foreach t in array append_only_tables loop
    execute format('create policy "%1$s_select_member" on public.%1$s for select using (public.is_tenant_member(tenant_id));', t);
    execute format('create policy "%1$s_insert_member" on public.%1$s for insert with check (public.is_tenant_member(tenant_id));', t);
  end loop;
end $$;

-- 16d. tenant_autonomy_settings: any member can read; only owner/ceo/admin
-- may change the Kill Switch / Autonomy Mode / guardrail limits. Insert is
-- restricted to the same roles (the one row per tenant is normally created
-- by this migration / handle_new_tenant_for_user, not by a UI action).
create policy "tenant_autonomy_settings_select_member" on public.tenant_autonomy_settings
  for select using (public.is_tenant_member(tenant_id));
create policy "tenant_autonomy_settings_insert_admin" on public.tenant_autonomy_settings
  for insert with check (public.has_tenant_role(tenant_id, array['owner', 'ceo', 'admin']));
create policy "tenant_autonomy_settings_update_admin" on public.tenant_autonomy_settings
  for update using (public.has_tenant_role(tenant_id, array['owner', 'ceo', 'admin']))
  with check (public.has_tenant_role(tenant_id, array['owner', 'ceo', 'admin']));

-- ============================================================
-- 17. handle_new_tenant_for_user: seed a default tenant_autonomy_settings
--     row, the 'work_creation' approval policy, and the 18-skill Registry
--     for brand-new tenants too (existing-tenant backfill already done in
--     sections 14-15 above). Full function body reproduced verbatim from
--     the Phase 7 migration plus these additions, per this codebase's
--     established convention of re-defining this trigger function in full
--     on every migration that extends tenant provisioning.
-- ============================================================
create or replace function public.handle_new_tenant_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
  dept_sales uuid;
  dept_webconsul uuid;
  dept_production uuid;
  dept_qa uuid;
  agent_rei uuid;
begin
  insert into public.tenants (name, slug)
  values (
    coalesce(new.display_name, split_part(new.email, '@', 1)) || ' の会社',
    'tenant-' || replace(new.id::text, '-', '')
  )
  returning id into new_tenant_id;

  insert into public.memberships (tenant_id, user_id, role)
  values (new_tenant_id, new.id, 'owner');

  insert into public.departments (tenant_id, code, name, sort_order) values
    (new_tenant_id, 'sales', '営業部', 1),
    (new_tenant_id, 'web_consulting', 'Webコンサル部', 2),
    (new_tenant_id, 'production', '制作/実行', 3),
    (new_tenant_id, 'quality', '品質管理', 4);

  select id into dept_sales from public.departments where tenant_id = new_tenant_id and code = 'sales';
  select id into dept_webconsul from public.departments where tenant_id = new_tenant_id and code = 'web_consulting';
  select id into dept_production from public.departments where tenant_id = new_tenant_id and code = 'production';
  select id into dept_qa from public.departments where tenant_id = new_tenant_id and code = 'quality';

  insert into public.agents (tenant_id, code, name, role, job_title, description, avatar, capabilities) values
    (new_tenant_id, 'rei', 'レイ', 'supervisor', 'AI統括', 'Business Orchestratorを監督するSupervisor Agent', 'rei', '["supervision"]'::jsonb),
    (new_tenant_id, 'scout', 'スカウト', 'lead_discovery', 'Lead Discovery', '案件候補（Lead）の発見・登録を担当', 'scout', '[]'::jsonb),
    (new_tenant_id, 'research', 'リサーチ', 'company_research', 'Company Research', '企業調査を実行', 'research', '[]'::jsonb),
    (new_tenant_id, 'sales', 'セール', 'sales_strategy', 'Sales Strategy', '営業候補（提案の骨子）を作成', 'sales', '["sales_coordination", "sales_strategy"]'::jsonb),
    (new_tenant_id, 'sou', 'ソウ', 'website_diagnosis', 'Website Diagnosis', 'Webサイト診断を実行', 'sou', '[]'::jsonb),
    (new_tenant_id, 'seo', 'セオ', 'seo', 'SEO', 'SEO施策を担当', 'seo', '[]'::jsonb),
    (new_tenant_id, 'geo', 'ジオ', 'aio_geo', 'AIO / GEO / AEO', 'AI検索最適化を担当', 'geo', '[]'::jsonb),
    (new_tenant_id, 'mina', 'ミナ', 'analytics', 'Analytics', '効果測定・分析を担当', 'mina', '["measurement", "analytics"]'::jsonb),
    (new_tenant_id, 'kei', 'ケイ', 'strategy', 'Strategy', '戦略立案を担当', 'kei', '[]'::jsonb),
    (new_tenant_id, 'taku', 'タク', 'director', 'Director / Task Planner', 'タスク計画とディレクションを担当', 'taku', '[]'::jsonb),
    (new_tenant_id, 'kuro', 'クロ', 'critic', 'Critic / AI監査', '他Agentの成果物をレビューし差し戻しを判断', 'kuro', '["critic_review"]'::jsonb),
    (new_tenant_id, 'qa', 'QA', 'qa', 'Quality Assurance', '最終品質チェックを担当', 'qa', '[]'::jsonb),
    (new_tenant_id, 'repo', 'レポ', 'report', 'Report', '月次レポート作成を担当', 'repo', '["monthly_report"]'::jsonb),
    (new_tenant_id, 'contract', '契約', 'contract_review', 'Contract Review', '契約書の抽出・リスク整理を担当', 'contract', '[]'::jsonb),
    (new_tenant_id, 'scorer', 'スコア', 'lead_scoring', 'Lead Scoring', '案件化可能性を多軸スコアで評価', 'scorer', '[]'::jsonb),
    (new_tenant_id, 'writer', 'ライター', 'sales_writer', 'Sales Writer', '営業文・提案草案を作成（送信は行わない）', 'writer', '[]'::jsonb),
    (new_tenant_id, 'outreach', 'アウトリーチ', 'sales_outreach', 'Sales Outreach', '営業文作成・チャネル選定（送信は行わない）', 'outreach', '["sales_outreach", "channel_selection", "email_draft"]'::jsonb),
    (new_tenant_id, 'analyst', 'アナリスト', 'response_analysis', 'Response Analyst', '返信の分類・返信案作成', 'analyst', '["reply_classification", "reply_draft"]'::jsonb),
    (new_tenant_id, 'meeting', 'ミーティング', 'meeting_coordination', 'Meeting Coordinator', '商談日程調整・準備・議事録Draft', 'meeting', '["meeting_scheduling", "meeting_prep", "meeting_minutes"]'::jsonb),
    (new_tenant_id, 'proposal', 'プロポーザル', 'proposal_writer', 'Proposal Agent', '提案書Draft作成', 'proposal', '["proposal_draft"]'::jsonb),
    (new_tenant_id, 'estimate', 'エスティメイト', 'estimate_writer', 'Estimate Agent', '見積Draft作成（価格マスタ参照）', 'estimate', '["estimate_draft", "pricing"]'::jsonb),
    (new_tenant_id, 'negotiator', 'ネゴシエーター', 'negotiation_support', 'Negotiation Agent', '交渉論点の整理（値引き確定は行わない）', 'negotiator', '["negotiation_analysis"]'::jsonb),
    (new_tenant_id, 'renewal', 'ケイゾク', 'renewal', 'Renewal Agent', '契約更新リスクとRenewal提案の下書きを担当', 'renewal', '["renewal_readiness"]'::jsonb),
    (new_tenant_id, 'upsell', 'アップ', 'upsell', 'Upsell Agent', 'KPI GapやFindingからアップセル候補を作成', 'upsell', '["upsell_detection"]'::jsonb);

  select id into agent_rei from public.agents where tenant_id = new_tenant_id and code = 'rei';

  insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
  select new_tenant_id, a.id, dept_sales
  from public.agents a
  where a.tenant_id = new_tenant_id and a.code in (
    'scout', 'research', 'sales', 'scorer', 'writer', 'outreach', 'analyst', 'meeting', 'proposal', 'estimate', 'negotiator'
  );

  insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
  select new_tenant_id, a.id, dept_webconsul
  from public.agents a
  where a.tenant_id = new_tenant_id and a.code in ('sou', 'seo', 'geo', 'mina', 'kei');

  insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
  select new_tenant_id, a.id, dept_production
  from public.agents a
  where a.tenant_id = new_tenant_id and a.code in ('taku', 'repo', 'contract', 'renewal', 'upsell');

  insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
  select new_tenant_id, a.id, dept_qa
  from public.agents a
  where a.tenant_id = new_tenant_id and a.code in ('kuro', 'qa');

  insert into public.icp_profiles (
    tenant_id, name, is_default, target_industries, target_regions, employee_size_min, employee_size_max,
    business_model, requires_website, target_services, target_price_floor, exclusion_conditions
  ) values (
    new_tenant_id, '成長中BtoB企業', true, '[]'::jsonb, '["全国"]'::jsonb, 10, 300,
    'b2b', true, '["SEO", "AIO", "GEO"]'::jsonb, 200000, '[]'::jsonb
  );

  insert into public.service_catalog (tenant_id, code, name, category, pricing_model, standard_price, setup_fee, unit, description) values
    (new_tenant_id, 'SEO', 'SEO Standard', 'SEO', 'monthly', 248000, 0, '月', '検索エンジン最適化の標準プラン'),
    (new_tenant_id, 'AIO', 'AIO/GEO Standard', 'AIO', 'monthly', 198000, 50000, '月', 'AI検索最適化(AIO/GEO/AEO)の標準プラン'),
    (new_tenant_id, 'CRO', 'CRO Standard', 'CRO', 'monthly', 158000, 0, '月', '問い合わせ導線改善(CRO)の標準プラン'),
    (new_tenant_id, 'Web Renewal', 'Webサイトリニューアル', 'Production', 'one_time', 980000, 0, '式', 'サイト刷新一式');

  insert into public.business_calendars (tenant_id, name, timezone, working_days, business_hours, is_default)
  values (new_tenant_id, 'Default', 'Asia/Tokyo', '[1,2,3,4,5]'::jsonb, '{"start":"09:00","end":"18:00"}'::jsonb, true);

  insert into public.approval_policies (tenant_id, code, description, conditions, steps) values
    (new_tenant_id, 'sales_send', '営業メール送信', '{}'::jsonb, '[{"role":"manager"}]'::jsonb),
    (new_tenant_id, 'estimate_amount_low', '見積30万円未満', '{"amountLt": 300000}'::jsonb, '[{"role":"manager"}]'::jsonb),
    (new_tenant_id, 'estimate_amount_high', '見積30万円以上', '{"amountGte": 300000}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb),
    (new_tenant_id, 'discount_low', '値引き5%以下', '{"discountRateLte": 0.05}'::jsonb, '[{"role":"manager"}]'::jsonb),
    (new_tenant_id, 'discount_high', '値引き5%超', '{"discountRateGt": 0.05}'::jsonb, '[{"role":"ceo"}]'::jsonb),
    (new_tenant_id, 'deal_won', '受注確定', '{}'::jsonb, '[{"role":"ceo"}]'::jsonb),
    (new_tenant_id, 'delivery', '納品承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb),
    (new_tenant_id, 'monthly_report', '月次レポート承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb),
    (new_tenant_id, 'upsell_opportunity', 'アップセル提案承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb),
    (new_tenant_id, 'work_creation', 'Autonomy Runtime Work承認', '{}'::jsonb, '[{"role":"manager"}]'::jsonb);

  insert into public.sla_policies (tenant_id, entity_type, event_type, priority, target_duration, duration_unit) values
    (new_tenant_id, 'sales_message', 'positive_reply', 'P1', 4, 'business_hours'),
    (new_tenant_id, 'sales_message', 'meeting_request', 'P0', 2, 'business_hours'),
    (new_tenant_id, 'approval_request', 'proposal_revision', null, 1, 'business_days'),
    (new_tenant_id, 'approval_request', 'contract_high_risk', null, 4, 'business_hours');

  -- PHASE 1: Autonomy Runtime defaults to fully OFF/disabled for every new
  -- tenant. A human must explicitly enable feature_enabled + choose a mode
  -- via the Pilot Cockpit — nothing here activates autonomy automatically.
  insert into public.tenant_autonomy_settings (tenant_id) values (new_tenant_id);

  insert into public.skill_definitions (tenant_id, name, description, department, executor_ref, risk_level, approval_policy_code) values
    (new_tenant_id, 'Lead Discovery', 'ICPに基づくリード探索・スコアリング', 'sales', 'lead_discovery_graph', 'LOW', null),
    (new_tenant_id, 'Lead Generation', 'リード調査・戦略立案（レガシー経路）', 'sales', 'lead_generation_graph', 'LOW', null),
    (new_tenant_id, 'Sales Finalize', '受注確定処理', 'sales', 'sales_graph', 'MEDIUM', 'deal_won'),
    (new_tenant_id, 'Sales Draft', '営業提案の骨子作成', 'sales', 'sales_draft_graph', 'LOW', null),
    (new_tenant_id, 'Sales Outreach Prep', '営業文作成・チャネル選定', 'sales', 'sales_outreach_prep_graph', 'MEDIUM', 'sales_send'),
    (new_tenant_id, 'Reply Analysis', '返信分類・返信案作成', 'sales', 'reply_analysis_graph', 'LOW', null),
    (new_tenant_id, 'Meeting Scheduling', '商談候補日時の提示', 'sales', 'meeting_scheduling_graph', 'LOW', null),
    (new_tenant_id, 'Meeting Prep', '商談準備資料の作成', 'sales', 'meeting_prep_graph', 'LOW', null),
    (new_tenant_id, 'Meeting Minutes', '議事録ドラフト作成', 'sales', 'meeting_minutes_graph', 'LOW', null),
    (new_tenant_id, 'Proposal Draft', '提案書・見積ドラフト作成', 'sales', 'proposal_draft_graph', 'MEDIUM', null),
    (new_tenant_id, 'Negotiation Analysis', '交渉論点の整理', 'sales', 'negotiation_analysis_graph', 'MEDIUM', null),
    (new_tenant_id, 'Deal Won Gate', '受注確定前提条件チェック', 'sales', 'deal_won_gate_graph', 'HIGH', 'deal_won'),
    (new_tenant_id, 'Contract Review', '契約書レビュー', 'production', 'contract_graph', 'HIGH', null),
    (new_tenant_id, 'Onboarding', 'プロジェクト立ち上げ', 'production', 'onboarding_graph', 'MEDIUM', null),
    (new_tenant_id, 'Execution', 'タスク実行キュー処理', 'production', 'execution_graph', 'MEDIUM', null),
    (new_tenant_id, 'Delivery', '納品準備', 'production', 'delivery_graph', 'MEDIUM', 'delivery'),
    (new_tenant_id, 'Measurement', 'KPI測定・異常検知・月次レポート', 'production', 'measurement_graph', 'LOW', null),
    (new_tenant_id, 'Renewal', '契約更新リスク・アップセル検知', 'production', 'renewal_graph', 'MEDIUM', null);

  return new;
end;
$$;
