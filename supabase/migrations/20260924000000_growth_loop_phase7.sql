-- AI Company OS: Phase 7 — Measurement / Reporting / Renewal / Upsell Growth Loop
--
-- Takes the company from "wins and executes a deal" to "measures outcomes,
-- explains them, and drives its own continuation/expansion revenue". Follows
-- the same consolidation discipline as Phase 3-5: a new table only where the
-- entity genuinely needs first-class rows (Critic/Approval/Conversion
-- lifecycle, or values that must never retroactively change).
--
-- Design notes:
--   * READY_FOR_DELIVERY vs DELIVERED (spec §2-3): `projects.status` gains
--     'ready_for_delivery' as a distinct state BEFORE 'delivered'. The
--     existing `delivery_graph` (Phase 1) now only gets a project to
--     ready_for_delivery; a new `delivery_records` table + explicit human
--     action (lib/server/deliveryConfirmation.ts) is what actually flips a
--     project to 'delivered' — Human Action or approved External Action,
--     never automatic.
--   * measurement_plans / kpi_snapshots / anomaly_events / reporting_cycles /
--     monthly_reports / contract_renewals / upsell_opportunities are new
--     tables: each carries its own Critic/Approval/Conversion/immutability
--     lifecycle that cannot be folded into an existing jsonb column without
--     losing queryability (e.g. "list all UPCOMING renewals across tenant").
--   * monthly_reports reuses the exact proposals/estimates immutable-
--     versioning pattern from Phase 5 (content_json + snapshot_hash +
--     a BEFORE UPDATE trigger that rejects content mutation once
--     APPROVED/DELIVERED) — a delivered report must never silently change.
--   * Upsell Opportunity Conversion (spec §79) reuses the existing
--     leads/opportunities sales pipeline rather than inventing a parallel
--     one: approving an upsell_opportunities row inserts a new `leads` row
--     (source='upsell_expansion') + `opportunities` row at 'QUALIFIED' stage
--     (see lib/server/approvals.ts). No new sales-pipeline tables here.

-- ============================================================
-- 1. Delivery confirmation split (spec §2-3)
-- ============================================================
alter table public.projects drop constraint projects_status_check;
alter table public.projects add constraint projects_status_check check (status in (
  'active', 'ready_for_delivery', 'completed', 'delivered'
));

create table public.delivery_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid references public.clients (id),
  project_id uuid not null references public.projects (id) on delete cascade,
  deliverable_ids uuid[] not null default '{}',
  delivery_package_id uuid references public.delivery_packages (id),
  delivered_by uuid not null references auth.users (id),
  delivered_at timestamptz not null default now(),
  delivery_channel text not null default 'email' check (delivery_channel in ('email', 'meeting', 'portal', 'other')),
  recipient text,
  snapshot_hash text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index delivery_records_project_idx on public.delivery_records (tenant_id, project_id);

-- ============================================================
-- 2. Contract terms needed by the Renewal Agent (spec §132)
-- ============================================================
alter table public.contracts
  add column start_date date,
  add column end_date date,
  add column auto_renew boolean not null default true,
  add column notice_period_days integer not null default 30;

-- ============================================================
-- 3. KPI Definition fields (spec §9-10) + measurement scheduling hint
-- ============================================================
alter table public.kpis
  add column definition text,
  add column formula text,
  add column source text not null default 'manual' check (source in ('manual', 'ga4', 'gsc', 'ads', 'semrush', 'clarity', 'gbp', 'csv', 'internal')),
  add column direction text not null default 'HIGHER_IS_BETTER' check (direction in ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'TARGET_RANGE', 'BOOLEAN')),
  add column warning_threshold numeric,
  add column critical_threshold numeric,
  add column measurement_frequency text not null default 'monthly',
  -- Which initiative category this KPI tracks, used only to pick the
  -- Measurement Trigger delay (spec §4: SEO=14d/Content=28d/CRO=sufficient
  -- sessions(→28d)/Ads=7d; unknown defaults to 14d). Never a hard workflow
  -- gate — a human can always evaluate early via the manual endpoint.
  add column initiative_type text check (initiative_type in ('seo', 'content', 'cro', 'ads', 'other'));

-- ============================================================
-- 4. Measurement Plan (spec §5-6) + KPI Snapshot (spec §7-8)
-- ============================================================
create table public.measurement_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  initiative_id uuid references public.initiatives (id),
  implementation_id uuid references public.deliverables (id),
  kpi_id uuid not null references public.kpis (id) on delete cascade,
  baseline_window jsonb not null default '{}'::jsonb,
  measurement_window jsonb not null default '{}'::jsonb,
  comparison_type text not null default 'PRE_POST' check (comparison_type in ('PRE_POST', 'MOM', 'YOY', 'TARGET', 'CONTROL', 'CUSTOM')),
  minimum_data_requirement jsonb not null default '{}'::jsonb,
  start_at timestamptz not null,
  end_at timestamptz,
  status text not null default 'PLANNED' check (status in (
    'PLANNED', 'WAITING', 'COLLECTING', 'READY_TO_EVALUATE', 'EVALUATING',
    'COMPLETED', 'INSUFFICIENT_DATA', 'FAILED'
  )),
  evaluation_method text not null default 'deterministic_rule',
  owner_agent_id uuid references public.agents (id),
  baseline_snapshot_id uuid,
  latest_evaluation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger measurement_plans_set_updated_at before update on public.measurement_plans
  for each row execute function public.set_updated_at();

create index measurement_plans_project_idx on public.measurement_plans (tenant_id, project_id);
create index measurement_plans_status_idx on public.measurement_plans (tenant_id, status);

create table public.kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kpi_id uuid not null references public.kpis (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  measurement_plan_id uuid references public.measurement_plans (id),
  snapshot_type text not null check (snapshot_type in ('BASELINE', 'CURRENT', 'TARGET', 'MONTH_END', 'CUSTOM')),
  period_start date,
  period_end date,
  value numeric,
  unit text,
  source text not null default 'manual',
  source_account text,
  dimensions jsonb not null default '{}'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  -- Data Quality (spec §14-15): GOOD/WARNING/POOR never guessed away — a
  -- report must read this before stating a number as fact.
  data_quality text not null default 'GOOD' check (data_quality in ('GOOD', 'WARNING', 'POOR', 'UNKNOWN')),
  data_quality_reason text,
  is_estimated boolean not null default false,
  captured_by_user_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.measurement_plans
  add constraint measurement_plans_baseline_snapshot_fkey
  foreign key (baseline_snapshot_id) references public.kpi_snapshots (id);

create index kpi_snapshots_kpi_idx on public.kpi_snapshots (tenant_id, kpi_id, snapshot_type, captured_at desc);
create index kpi_snapshots_project_idx on public.kpi_snapshots (tenant_id, project_id);

-- ============================================================
-- 5. Anomaly Detection (spec §26-29)
-- ============================================================
create table public.anomaly_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kpi_id uuid references public.kpis (id),
  measurement_plan_id uuid references public.measurement_plans (id),
  metric text not null,
  expected_range jsonb not null default '{}'::jsonb,
  actual numeric,
  severity text not null check (severity in ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
  source text not null default 'measurement_agent',
  possible_causes jsonb not null default '[]'::jsonb,
  acknowledged boolean not null default false,
  acknowledged_by_user_id uuid references auth.users (id),
  acknowledged_at timestamptz,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index anomaly_events_project_idx on public.anomaly_events (tenant_id, project_id, detected_at desc);

-- ============================================================
-- 6. Monthly Reporting Cycle (spec §34-37, §100-103)
-- ============================================================
create table public.reporting_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  data_cutoff_at timestamptz,
  report_due date,
  client_meeting_date date,
  status text not null default 'DATA_COLLECTION' check (status in (
    'DATA_COLLECTION', 'ANALYSIS', 'REPORT_DRAFT', 'INTERNAL_REVIEW',
    'CLIENT_DELIVERY', 'NEXT_PLAN', 'COMPLETED'
  )),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, project_id, period_start)
);

create trigger reporting_cycles_set_updated_at before update on public.reporting_cycles
  for each row execute function public.set_updated_at();

-- Monthly Report: content_json/snapshot_hash/immutability mirrors
-- proposals/estimates (Phase 5) exactly — a delivered report is a legal/
-- factual record and must never retroactively change even if the KPI source
-- data later moves (spec §36, §50).
create table public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  reporting_cycle_id uuid not null references public.reporting_cycles (id) on delete cascade,
  version integer not null default 1,
  previous_version_id uuid references public.monthly_reports (id),
  period_start date not null,
  period_end date not null,
  comparison_period text,
  data_cutoff_at timestamptz,
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'CRITIC_REVIEW', 'REVISION', 'QA', 'MANAGER_REVIEW', 'CEO_REVIEW',
    'APPROVED', 'CLIENT_PREVIEW', 'DELIVERED', 'REJECTED'
  )),
  content_json jsonb not null default '{}'::jsonb,
  snapshot_hash text,
  critic_notes jsonb not null default '[]'::jsonb,
  qa_notes jsonb not null default '[]'::jsonb,
  approval_request_id uuid references public.approval_requests (id),
  client_visible_file_id uuid references public.generated_files (id),
  delivered_at timestamptz,
  delivered_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger monthly_reports_set_updated_at before update on public.monthly_reports
  for each row execute function public.set_updated_at();

create index monthly_reports_project_idx on public.monthly_reports (tenant_id, project_id, created_at desc);

create function public.enforce_monthly_report_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('APPROVED', 'CLIENT_PREVIEW', 'DELIVERED') then
    if new.content_json is distinct from old.content_json
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
    then
      raise exception 'monthly_reports: cannot modify the content of an already-% report (id=%). Create a new version instead.', old.status, old.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger monthly_reports_enforce_immutability before update on public.monthly_reports
  for each row execute function public.enforce_monthly_report_immutability();

-- ============================================================
-- 7. Renewal Management (spec §62-71)
-- ============================================================
create table public.contract_renewals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  project_id uuid references public.projects (id),
  current_end_date date not null,
  notice_deadline date,
  renewal_date date,
  renewal_type text check (renewal_type in ('AUTO', 'MANUAL', 'RENEGOTIATED')),
  status text not null default 'NOT_DUE' check (status in (
    'NOT_DUE', 'UPCOMING', 'PREPARING', 'CLIENT_REVIEW', 'NEGOTIATING',
    'RENEWED', 'NOT_RENEWED', 'CANCELLED'
  )),
  risk_level text check (risk_level in ('GREEN', 'YELLOW', 'RED')),
  risk_factors jsonb not null default '{}'::jsonb,
  owner_agent_id uuid references public.agents (id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contract_id, current_end_date)
);

create trigger contract_renewals_set_updated_at before update on public.contract_renewals
  for each row execute function public.set_updated_at();

create index contract_renewals_status_idx on public.contract_renewals (tenant_id, status);

-- ============================================================
-- 8. Upsell Opportunity (spec §72-82)
-- ============================================================
create table public.upsell_opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid references public.clients (id),
  project_id uuid references public.projects (id),
  source_type text not null check (source_type in (
    'KPI', 'FINDING', 'CLIENT_REQUEST', 'MEETING', 'REPORT', 'USAGE', 'BUSINESS_CHANGE', 'GROWTH_SIGNAL'
  )),
  source_reference_id uuid,
  problem text not null,
  business_impact text,
  recommended_service text not null,
  estimated_value numeric,
  confidence text check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH')),
  status text not null default 'DETECTED' check (status in (
    'DETECTED', 'INTERNAL_REVIEW', 'APPROVAL_PENDING', 'APPROVED', 'PROPOSED', 'ACCEPTED', 'REJECTED', 'ON_HOLD'
  )),
  critic_notes jsonb not null default '[]'::jsonb,
  approval_request_id uuid references public.approval_requests (id),
  converted_opportunity_id uuid references public.opportunities (id),
  rejected_reason text,
  -- Upsell Cooldown (spec §141): a rejected candidate for the same
  -- client+recommended_service cannot be re-detected until this date.
  cooldown_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger upsell_opportunities_set_updated_at before update on public.upsell_opportunities
  for each row execute function public.set_updated_at();

create index upsell_opportunities_client_idx on public.upsell_opportunities (tenant_id, client_id, status);

-- ============================================================
-- 8b. generated_files: allow monthly_report as an entity_type (spec §51,
-- reusing the exact PDF pipeline from Phase 5 documentGeneration.ts).
-- ============================================================
alter table public.generated_files drop constraint generated_files_entity_type_check;
alter table public.generated_files add constraint generated_files_entity_type_check check (entity_type in ('proposal', 'estimate', 'delivery_package', 'monthly_report'));

-- ============================================================
-- 9. Approval Policies for the new approval types (spec §49, §78)
-- ============================================================
insert into public.approval_policies (tenant_id, code, description, conditions, steps)
select t.id, 'monthly_report', '月次レポート承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb
from public.tenants t
where not exists (select 1 from public.approval_policies p where p.tenant_id = t.id and p.code = 'monthly_report');

insert into public.approval_policies (tenant_id, code, description, conditions, steps)
select t.id, 'upsell_opportunity', 'アップセル提案承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb
from public.tenants t
where not exists (select 1 from public.approval_policies p where p.tenant_id = t.id and p.code = 'upsell_opportunity');

-- ============================================================
-- 10. Agent roster additions (spec §93-96): Renewal Agent / Upsell Agent.
-- Measurement/Analytics/Report/Strategy reuse existing mina/repo/kei; Critic
-- reuses kuro; QA reuses qa — no new agents needed for those roles.
-- ============================================================
insert into public.agents (tenant_id, code, name, role, job_title, description, avatar, capabilities)
select t.id, 'renewal', 'ケイゾク', 'renewal', 'Renewal Agent', '契約更新リスクとRenewal提案の下書きを担当', 'renewal', '["renewal_readiness"]'::jsonb
from public.tenants t
where not exists (select 1 from public.agents a where a.tenant_id = t.id and a.code = 'renewal');

insert into public.agents (tenant_id, code, name, role, job_title, description, avatar, capabilities)
select t.id, 'upsell', 'アップ', 'upsell', 'Upsell Agent', 'KPI GapやFindingからアップセル候補を作成', 'upsell', '["upsell_detection"]'::jsonb
from public.tenants t
where not exists (select 1 from public.agents a where a.tenant_id = t.id and a.code = 'upsell');

insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
select a.tenant_id, a.id, d.id
from public.agents a
join public.departments d on d.tenant_id = a.tenant_id and d.code = 'production'
where a.code in ('renewal', 'upsell')
  and not exists (
    select 1 from public.agent_department_assignments x where x.agent_id = a.id and x.department_id = d.id
  );

-- ============================================================
-- 11. RLS for every new tenant-scoped table
-- ============================================================
alter table public.delivery_records enable row level security;
alter table public.measurement_plans enable row level security;
alter table public.kpi_snapshots enable row level security;
alter table public.anomaly_events enable row level security;
alter table public.reporting_cycles enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.contract_renewals enable row level security;
alter table public.upsell_opportunities enable row level security;

do $$
declare
  t text;
  member_tables text[] := array[
    'delivery_records', 'measurement_plans', 'kpi_snapshots', 'anomaly_events',
    'reporting_cycles', 'monthly_reports', 'contract_renewals', 'upsell_opportunities'
  ];
begin
  foreach t in array member_tables loop
    execute format(
      'create policy "%1$s_select_member" on public.%1$s for select using (public.is_tenant_member(tenant_id));',
      t
    );
    execute format(
      'create policy "%1$s_insert_member" on public.%1$s for insert with check (public.is_tenant_member(tenant_id));',
      t
    );
    execute format(
      'create policy "%1$s_update_member" on public.%1$s for update using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));',
      t
    );
    execute format(
      'create policy "%1$s_delete_admin" on public.%1$s for delete using (public.has_tenant_role(tenant_id, array[''owner'', ''ceo'', ''admin'']));',
      t
    );
  end loop;
end $$;

-- ============================================================
-- 12. handle_new_tenant_for_user: seed the two new approval policies +
-- renewal/upsell agents for brand-new tenants too (existing-tenant backfill
-- already done in section 9-10 above).
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
    (new_tenant_id, 'upsell_opportunity', 'アップセル提案承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb);

  insert into public.sla_policies (tenant_id, entity_type, event_type, priority, target_duration, duration_unit) values
    (new_tenant_id, 'sales_message', 'positive_reply', 'P1', 4, 'business_hours'),
    (new_tenant_id, 'sales_message', 'meeting_request', 'P0', 2, 'business_hours'),
    (new_tenant_id, 'approval_request', 'proposal_revision', null, 1, 'business_days'),
    (new_tenant_id, 'approval_request', 'contract_high_risk', null, 4, 'business_hours');

  return new;
end;
$$;
