-- AI Company OS: Phase 5 — Production Sales Operations
-- (Real Google OAuth, Task conversion, Version/Reconciliation, Documents,
--  File Security, SLA / Business Calendar / Follow-up / Manager Approval)
--
-- Design notes (consolidation, per the product brief's own instruction to
-- avoid unnecessary table splits):
--   * Proposal/Estimate "immutable versioning" (spec §27-31) is achieved by
--     extending the EXISTING `proposals`/`estimates` tables (already one row
--     per version, with `version`/`previous_version_id`) with
--     `content_json`/`snapshot_hash`/`change_summary`, plus a trigger that
--     rejects content mutation once a row's status reached
--     APPROVED/SENT/ACCEPTED. No new `proposal_versions`/`estimate_versions`
--     child tables — the existing rows already ARE the versions.
--   * Approval Chain / Manager+CEO routing (spec §51-53) is `steps` jsonb on
--     the existing `approval_requests` table, not a new `approval_steps`
--     table — a single row's lifecycle already covers one approval request.
--   * Meeting Action Items (spec §21-26) DO get a real new table this phase
--     (`meeting_action_items`): Phase 4 kept them as jsonb on `meetings`,
--     but this phase's explicit status lifecycle (CANDIDATE -> CONFIRMED ->
--     CONVERTED_TO_TASK), duplicate-detection, and Task traceability
--     genuinely need first-class rows with real foreign keys.
--
-- New tables kept distinct because they are genuinely independent entities:
-- integration_connections, oauth_states, meeting_action_items,
-- delivery_packages, generated_files, approval_policies, business_calendars,
-- business_calendar_holidays, sla_policies, followup_candidates,
-- background_jobs.

-- ============================================================
-- 1. memberships: add the `manager` role (spec §50)
-- ============================================================
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'ceo', 'admin', 'manager', 'member'));

-- ============================================================
-- 2. integration_connections + oauth_states (spec §5-9)
-- ============================================================
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google')),
  status text not null default 'not_connected' check (status in (
    'not_connected', 'connecting', 'connected', 'needs_reauth', 'permission_error', 'expired', 'disabled'
  )),
  scopes jsonb not null default '[]'::jsonb,
  connected_email text,
  -- Encryption at rest (spec §7): ciphertext + IV, never the plaintext token.
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_iv text,
  expires_at timestamptz,
  connected_at timestamptz,
  last_synced_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, provider)
);

create trigger integration_connections_set_updated_at before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- Short-lived, single-use OAuth state (spec §6): the code_verifier (PKCE)
-- never leaves the server, and `state` is checked against this row rather
-- than trusted from the callback request alone (CSRF defense).
create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  state text not null unique,
  code_verifier text not null,
  scopes jsonb not null default '[]'::jsonb,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_states_expires_idx on public.oauth_states (expires_at);

-- ============================================================
-- 3. approval_requests: Chain / Snapshot Hash / Expiration / SLA
--    (spec §13, §52-53, §63-64, §81-82)
-- ============================================================
alter table public.approval_requests
  add column snapshot_hash text,
  add column expires_at timestamptz,
  -- steps: [{ role, status, approver_user_id, decided_at }]
  add column steps jsonb not null default '[]'::jsonb,
  add column current_step integer not null default 0,
  add column policy_code text,
  add column sla_due_at timestamptz,
  add column sla_status text check (sla_status in ('ON_TRACK', 'DUE_SOON', 'BREACHED', 'COMPLETED'));

-- ============================================================
-- 4. proposals / estimates: content_json + snapshot_hash + immutability
--    (spec §27-31)
-- ============================================================
alter table public.proposals
  add column content_json jsonb,
  add column snapshot_hash text,
  add column change_summary text;

alter table public.estimates
  add column content_json jsonb,
  add column snapshot_hash text,
  add column change_summary text;

create function public.enforce_proposal_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('APPROVED', 'SENT', 'ACCEPTED') then
    if new.title is distinct from old.title
      or new.executive_summary is distinct from old.executive_summary
      or new.client_challenges is distinct from old.client_challenges
      or new.goals is distinct from old.goals
      or new.recommended_solution is distinct from old.recommended_solution
      or new.scope is distinct from old.scope
      or new.deliverables is distinct from old.deliverables
      or new.timeline is distinct from old.timeline
      or new.kpis is distinct from old.kpis
      or new.assumptions is distinct from old.assumptions
      or new.exclusions is distinct from old.exclusions
      or new.risks is distinct from old.risks
      or new.next_step is distinct from old.next_step
      or new.content_json is distinct from old.content_json
    then
      raise exception 'proposals: cannot modify the content of an already-% version (id=%). Create a new version instead.', old.status, old.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger proposals_enforce_immutability before update on public.proposals
  for each row execute function public.enforce_proposal_immutability();

create function public.enforce_estimate_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('APPROVED', 'SENT', 'ACCEPTED') then
    if new.line_items is distinct from old.line_items
      or new.subtotal is distinct from old.subtotal
      or new.discount is distinct from old.discount
      or new.tax is distinct from old.tax
      or new.total is distinct from old.total
      or new.setup_fee is distinct from old.setup_fee
      or new.monthly_fee is distinct from old.monthly_fee
      or new.annual_value is distinct from old.annual_value
      or new.payment_terms is distinct from old.payment_terms
      or new.valid_until is distinct from old.valid_until
      or new.content_json is distinct from old.content_json
    then
      raise exception 'estimates: cannot modify the content of an already-% version (id=%). Create a new version instead.', old.status, old.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger estimates_enforce_immutability before update on public.estimates
  for each row execute function public.enforce_estimate_immutability();

-- ============================================================
-- 5. meeting_action_items (spec §21-26)
-- ============================================================
create table public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  opportunity_id uuid references public.opportunities (id) on delete cascade,

  description text not null,
  -- Unknown fields stay null — never guessed (spec §22, same rule as
  -- meeting minutes' UNKNOWN/UNASSIGNED/UNSET placeholders).
  owner text,
  due_date date,
  priority text check (priority in ('LOW', 'MEDIUM', 'HIGH')),
  related_goal text,
  related_kpi text,
  related_project_id uuid references public.projects (id),
  evidence_reference text,
  confidence text check (confidence in ('HIGH', 'MEDIUM', 'LOW')),

  status text not null default 'CANDIDATE' check (status in ('CANDIDATE', 'CONFIRMED', 'REJECTED', 'CONVERTED_TO_TASK')),
  possible_duplicate_of uuid references public.meeting_action_items (id),
  task_id uuid references public.tasks (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger meeting_action_items_set_updated_at before update on public.meeting_action_items
  for each row execute function public.set_updated_at();

create index meeting_action_items_meeting_idx on public.meeting_action_items (tenant_id, meeting_id);
create index meeting_action_items_opportunity_idx on public.meeting_action_items (tenant_id, opportunity_id);

-- ============================================================
-- 6. Documents: generated_files + delivery_packages (spec §34-49)
-- ============================================================
create table public.generated_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid references public.clients (id),
  project_id uuid references public.projects (id),
  opportunity_id uuid references public.opportunities (id),
  entity_type text not null check (entity_type in ('proposal', 'estimate', 'delivery_package')),
  entity_id uuid not null,
  version_id uuid not null, -- = entity_id in this consolidated design; kept as its own column for explicit traceability
  file_type text not null check (file_type in ('PDF', 'PPTX')),
  -- No external object storage exists in this sandbox: the rendered bytes
  -- are stored directly in Postgres (`file_data`). `storage_path` is kept
  -- as the logical addressable name a real deployment would use for S3/GCS
  -- once wired in (see README Known Limitations).
  storage_path text not null,
  file_data bytea not null,
  checksum text not null,
  byte_size integer not null,
  classification text not null default 'INTERNAL' check (classification in ('INTERNAL', 'CLIENT_VISIBLE', 'CONFIDENTIAL', 'PUBLIC')),
  template_version text not null default 'v1',
  rendered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index generated_files_entity_idx on public.generated_files (tenant_id, entity_type, entity_id);

create table public.delivery_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id),
  estimate_id uuid not null references public.estimates (id),
  cover_message text,
  attachment_file_ids jsonb not null default '[]'::jsonb,
  package_hash text not null,
  approval_request_id uuid references public.approval_requests (id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'SENT')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger delivery_packages_set_updated_at before update on public.delivery_packages
  for each row execute function public.set_updated_at();

create index delivery_packages_opportunity_idx on public.delivery_packages (tenant_id, opportunity_id);

-- Download/share audit (spec §49).
create table public.file_access_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  file_id uuid not null references public.generated_files (id) on delete cascade,
  action text not null check (action in ('DOWNLOAD', 'SHARE_LINK_CREATED')),
  performed_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7. approval_policies (spec §51)
-- ============================================================
create table public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  description text,
  -- conditions example: {"amountLt": 300000} / {"discountRateGte": 0.05}
  conditions jsonb not null default '{}'::jsonb,
  -- steps example: [{"role":"manager"}] or [{"role":"manager"},{"role":"ceo"}]
  steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create trigger approval_policies_set_updated_at before update on public.approval_policies
  for each row execute function public.set_updated_at();

-- ============================================================
-- 8. business_calendars (spec §58-59)
-- ============================================================
create table public.business_calendars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null default 'Default',
  timezone text not null default 'Asia/Tokyo',
  working_days jsonb not null default '[1,2,3,4,5]'::jsonb, -- 0=Sun..6=Sat
  business_hours jsonb not null default '{"start":"09:00","end":"18:00"}'::jsonb,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_calendars_set_updated_at before update on public.business_calendars
  for each row execute function public.set_updated_at();

create table public.business_calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  business_calendar_id uuid not null references public.business_calendars (id) on delete cascade,
  holiday_date date not null,
  name text,
  created_at timestamptz not null default now(),
  unique (business_calendar_id, holiday_date)
);

-- ============================================================
-- 9. sla_policies (spec §61-64)
-- ============================================================
create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  entity_type text not null,
  event_type text not null,
  priority text,
  target_duration numeric not null,
  duration_unit text not null default 'business_hours' check (duration_unit in ('hours', 'business_hours', 'days', 'business_days')),
  business_calendar_id uuid references public.business_calendars (id),
  escalation_policy jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, entity_type, event_type)
);

-- ============================================================
-- 10. followup_candidates (spec §67-71)
-- ============================================================
create table public.followup_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  original_message_id uuid not null references public.sales_messages (id),
  sequence_number integer not null default 1,
  reason text,
  business_days_elapsed integer,
  draft_subject text,
  draft_body text,
  risk text,
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE', 'APPROVED', 'SENT', 'DISMISSED')),
  approval_request_id uuid references public.approval_requests (id),
  sales_message_id uuid references public.sales_messages (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, original_message_id, sequence_number)
);

create trigger followup_candidates_set_updated_at before update on public.followup_candidates
  for each row execute function public.set_updated_at();

-- ============================================================
-- 11. background_jobs (spec §72-73) — system-internal, not tenant data.
-- Written only by the service-role client used exclusively by /api/cron/*
-- routes (see lib/supabase/serviceRole.ts) — the one deliberate exception
-- to this codebase's "never a service-role key" rule, because a scheduled
-- job has no human session to derive tenant_id/RLS from. RLS is enabled
-- with NO policies, so no anon/authenticated request can touch this table
-- at all; only the service role (which bypasses RLS by design) can.
-- ============================================================
create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  locked_at timestamptz,
  lock_token uuid,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.background_jobs enable row level security;

-- ============================================================
-- 12. RLS for the rest of this phase's tenant-scoped tables
-- ============================================================
alter table public.integration_connections enable row level security;
alter table public.oauth_states enable row level security;
alter table public.meeting_action_items enable row level security;
alter table public.generated_files enable row level security;
alter table public.delivery_packages enable row level security;
alter table public.file_access_logs enable row level security;
alter table public.approval_policies enable row level security;
alter table public.business_calendars enable row level security;
alter table public.business_calendar_holidays enable row level security;
alter table public.sla_policies enable row level security;
alter table public.followup_candidates enable row level security;

do $$
declare
  t text;
  member_tables text[] := array[
    'meeting_action_items', 'generated_files', 'delivery_packages', 'file_access_logs',
    'approval_policies', 'business_calendars', 'business_calendar_holidays', 'sla_policies', 'followup_candidates'
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

-- integration_connections / oauth_states hold OAuth credentials — scoped to
-- the connecting user, not every tenant member, on top of tenant isolation.
create policy "integration_connections_select_own" on public.integration_connections
  for select using (public.is_tenant_member(tenant_id) and user_id = auth.uid());
create policy "integration_connections_insert_own" on public.integration_connections
  for insert with check (public.is_tenant_member(tenant_id) and user_id = auth.uid());
create policy "integration_connections_update_own" on public.integration_connections
  for update using (public.is_tenant_member(tenant_id) and user_id = auth.uid()) with check (public.is_tenant_member(tenant_id) and user_id = auth.uid());
create policy "integration_connections_delete_own" on public.integration_connections
  for delete using (public.is_tenant_member(tenant_id) and (user_id = auth.uid() or public.has_tenant_role(tenant_id, array['owner', 'ceo', 'admin'])));

create policy "oauth_states_select_own" on public.oauth_states
  for select using (public.is_tenant_member(tenant_id) and user_id = auth.uid());
create policy "oauth_states_insert_own" on public.oauth_states
  for insert with check (public.is_tenant_member(tenant_id) and user_id = auth.uid());
create policy "oauth_states_update_own" on public.oauth_states
  for update using (public.is_tenant_member(tenant_id) and user_id = auth.uid()) with check (public.is_tenant_member(tenant_id) and user_id = auth.uid());
create policy "oauth_states_delete_own" on public.oauth_states
  for delete using (public.is_tenant_member(tenant_id) and user_id = auth.uid());

-- ============================================================
-- 13. Seed a default Business Calendar (Asia/Tokyo, Mon-Fri) for every
-- tenant, new and existing (spec §59).
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
    (new_tenant_id, 'mina', 'ミナ', 'analytics', 'Analytics', '効果測定・分析を担当', 'mina', '[]'::jsonb),
    (new_tenant_id, 'kei', 'ケイ', 'strategy', 'Strategy', '戦略立案を担当', 'kei', '[]'::jsonb),
    (new_tenant_id, 'taku', 'タク', 'director', 'Director / Task Planner', 'タスク計画とディレクションを担当', 'taku', '[]'::jsonb),
    (new_tenant_id, 'kuro', 'クロ', 'critic', 'Critic / AI監査', '他Agentの成果物をレビューし差し戻しを判断', 'kuro', '["critic_review"]'::jsonb),
    (new_tenant_id, 'qa', 'QA', 'qa', 'Quality Assurance', '最終品質チェックを担当', 'qa', '[]'::jsonb),
    (new_tenant_id, 'repo', 'レポ', 'report', 'Report', '月次レポート作成を担当', 'repo', '[]'::jsonb),
    (new_tenant_id, 'contract', '契約', 'contract_review', 'Contract Review', '契約書の抽出・リスク整理を担当', 'contract', '[]'::jsonb),
    (new_tenant_id, 'scorer', 'スコア', 'lead_scoring', 'Lead Scoring', '案件化可能性を多軸スコアで評価', 'scorer', '[]'::jsonb),
    (new_tenant_id, 'writer', 'ライター', 'sales_writer', 'Sales Writer', '営業文・提案草案を作成（送信は行わない）', 'writer', '[]'::jsonb),
    (new_tenant_id, 'outreach', 'アウトリーチ', 'sales_outreach', 'Sales Outreach', '営業文作成・チャネル選定（送信は行わない）', 'outreach', '["sales_outreach", "channel_selection", "email_draft"]'::jsonb),
    (new_tenant_id, 'analyst', 'アナリスト', 'response_analysis', 'Response Analyst', '返信の分類・返信案作成', 'analyst', '["reply_classification", "reply_draft"]'::jsonb),
    (new_tenant_id, 'meeting', 'ミーティング', 'meeting_coordination', 'Meeting Coordinator', '商談日程調整・準備・議事録Draft', 'meeting', '["meeting_scheduling", "meeting_prep", "meeting_minutes"]'::jsonb),
    (new_tenant_id, 'proposal', 'プロポーザル', 'proposal_writer', 'Proposal Agent', '提案書Draft作成', 'proposal', '["proposal_draft"]'::jsonb),
    (new_tenant_id, 'estimate', 'エスティメイト', 'estimate_writer', 'Estimate Agent', '見積Draft作成（価格マスタ参照）', 'estimate', '["estimate_draft", "pricing"]'::jsonb),
    (new_tenant_id, 'negotiator', 'ネゴシエーター', 'negotiation_support', 'Negotiation Agent', '交渉論点の整理（値引き確定は行わない）', 'negotiator', '["negotiation_analysis"]'::jsonb);

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
  where a.tenant_id = new_tenant_id and a.code in ('taku', 'repo', 'contract');

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
    (new_tenant_id, 'delivery', '納品承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb);

  insert into public.sla_policies (tenant_id, entity_type, event_type, priority, target_duration, duration_unit) values
    (new_tenant_id, 'sales_message', 'positive_reply', 'P1', 4, 'business_hours'),
    (new_tenant_id, 'sales_message', 'meeting_request', 'P0', 2, 'business_hours'),
    (new_tenant_id, 'approval_request', 'proposal_revision', null, 1, 'business_days'),
    (new_tenant_id, 'approval_request', 'contract_high_risk', null, 4, 'business_hours');

  return new;
end;
$$;

-- Backfill: existing tenants get a default Business Calendar, starter
-- Approval Policies, and starter SLA Policies too.
do $$
declare
  tenant_row record;
  new_calendar_id uuid;
begin
  for tenant_row in select id from public.tenants loop
    if not exists (select 1 from public.business_calendars where tenant_id = tenant_row.id) then
      insert into public.business_calendars (tenant_id, name, timezone, working_days, business_hours, is_default)
      values (tenant_row.id, 'Default', 'Asia/Tokyo', '[1,2,3,4,5]'::jsonb, '{"start":"09:00","end":"18:00"}'::jsonb, true)
      returning id into new_calendar_id;
    end if;

    if not exists (select 1 from public.approval_policies where tenant_id = tenant_row.id) then
      insert into public.approval_policies (tenant_id, code, description, conditions, steps) values
        (tenant_row.id, 'sales_send', '営業メール送信', '{}'::jsonb, '[{"role":"manager"}]'::jsonb),
        (tenant_row.id, 'estimate_amount_low', '見積30万円未満', '{"amountLt": 300000}'::jsonb, '[{"role":"manager"}]'::jsonb),
        (tenant_row.id, 'estimate_amount_high', '見積30万円以上', '{"amountGte": 300000}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb),
        (tenant_row.id, 'discount_low', '値引き5%以下', '{"discountRateLte": 0.05}'::jsonb, '[{"role":"manager"}]'::jsonb),
        (tenant_row.id, 'discount_high', '値引き5%超', '{"discountRateGt": 0.05}'::jsonb, '[{"role":"ceo"}]'::jsonb),
        (tenant_row.id, 'deal_won', '受注確定', '{}'::jsonb, '[{"role":"ceo"}]'::jsonb),
        (tenant_row.id, 'delivery', '納品承認', '{}'::jsonb, '[{"role":"manager"},{"role":"ceo"}]'::jsonb);
    end if;

    if not exists (select 1 from public.sla_policies where tenant_id = tenant_row.id) then
      insert into public.sla_policies (tenant_id, entity_type, event_type, priority, target_duration, duration_unit) values
        (tenant_row.id, 'sales_message', 'positive_reply', 'P1', 4, 'business_hours'),
        (tenant_row.id, 'sales_message', 'meeting_request', 'P0', 2, 'business_hours'),
        (tenant_row.id, 'approval_request', 'proposal_revision', null, 1, 'business_days'),
        (tenant_row.id, 'approval_request', 'contract_high_risk', null, 4, 'business_hours');
    end if;
  end loop;
end $$;
