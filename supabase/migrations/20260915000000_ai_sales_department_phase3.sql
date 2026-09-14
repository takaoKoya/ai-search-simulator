-- AI Company OS: Phase 3 — AI Sales Department (Lead Discovery & Sales Intelligence)
--
-- Design note (avoiding unnecessary table splits, per the product brief):
--   * Company research, growth signals, and lite website diagnosis all reuse
--     the existing `findings` table (type discriminates: 'company_research',
--     'growth_signal', 'website_diagnosis_lite'). Evidence for a hypothesis
--     is referenced by finding id rather than duplicated into a new table.
--   * "Sales Discovery Run" reuses `workflow_runs` (graph_name =
--     'lead_discovery_graph', subject_type = 'sales_discovery_run') — its
--     budget, counters, and generated search strategies live in the existing
--     `state` jsonb column instead of a new `sales_discovery_runs` /
--     `sales_search_strategies` pair of tables.
--   * `sales_target_profiles` and `icp_profiles` from the brief are the same
--     concept (targeting criteria + score weights) and are merged into one
--     `icp_profiles` table.
--   * Duplicate-check results are stored directly on `leads`
--     (duplicate_status / duplicate_of_lead_id) rather than a separate
--     `lead_duplicates` table, since a lead has at most one such verdict.
--   * `lead_recommendations` and `lead_sales_hypotheses` are the same
--     artifact (a hypothesis always carries its recommended services) and
--     are merged into one `lead_sales_hypotheses` table.
--
-- New tables kept distinct because they are genuinely independent entities:
-- icp_profiles, do_not_contact, lead_scores, lead_sales_hypotheses, sales_drafts.

-- ============================================================
-- 1. leads: normalization, discovery pipeline stage, provenance, freshness
-- ============================================================
alter table public.leads
  add column domain text,
  add column normalized_company_name text,
  add column normalized_domain text,
  add column region text,
  add column source_type text not null default 'manual' check (source_type in (
    'manual', 'web_search', 'business_directory', 'serp', 'company_directory',
    'event', 'referral', 'existing_contact', 'import', 'api', 'other'
  )),
  add column source_url text,
  add column source_name text,
  add column discovered_at timestamptz not null default now(),
  add column duplicate_status text check (duplicate_status in (
    'NEW', 'EXISTING_LEAD', 'EXISTING_CLIENT', 'PREVIOUSLY_CONTACTED', 'BLOCKED', 'POSSIBLE_DUPLICATE'
  )),
  add column duplicate_of_lead_id uuid references public.leads (id),
  -- Discovery-pipeline stage (spec section 31). Kept separate from the
  -- Phase 1 `status` column (new/researching/.../won/lost) so existing
  -- Phase 1 rows and flows are completely unaffected.
  add column discovery_stage text check (discovery_stage in (
    'DISCOVERED', 'RESEARCHING', 'SCORING', 'QUALIFIED', 'CRITIC_REVIEW',
    'APPROVAL_PENDING', 'READY_FOR_OUTREACH', 'CONTACTED', 'RESPONDED', 'MEETING',
    'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD', 'BLOCKED', 'REJECTED', 'ARCHIVED'
  )),
  add column icp_profile_id uuid,
  add column score_version text,
  add column qualification text check (qualification in ('HOT', 'WARM', 'NURTURE', 'LOW')),
  add column ai_cost_yen numeric not null default 0,
  add column test_mode boolean not null default false,
  add column last_verified_at timestamptz;

create index leads_normalized_domain_idx on public.leads (tenant_id, normalized_domain);
create index leads_normalized_name_idx on public.leads (tenant_id, normalized_company_name);
create index leads_discovery_stage_idx on public.leads (tenant_id, discovery_stage);

-- ============================================================
-- 2. icp_profiles: merged Sales Target Profile + Ideal Customer Profile
-- ============================================================
create table public.icp_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,

  target_industries jsonb not null default '[]'::jsonb,
  target_regions jsonb not null default '[]'::jsonb,
  employee_size_min integer,
  employee_size_max integer,
  revenue_range text,
  business_model text check (business_model in ('b2b', 'b2c', 'both')),
  requires_website boolean,
  requires_ecommerce boolean,
  requires_physical_store boolean,
  ad_spend_expected boolean,
  seo_state_target text,
  meo_importance text,
  aio_fit_target text,
  site_update_expectation text,
  hiring_signal_weight numeric,
  target_services jsonb not null default '[]'::jsonb,
  target_price_floor numeric,
  exclusion_conditions jsonb not null default '[]'::jsonb,

  -- Section 17 weights, must sum to 100; Section 19 thresholds.
  score_weights jsonb not null default (
    '{"icp_fit": 25, "business_potential": 20, "web_problem": 20, "timing": 15, "service_fit": 10, "contactability": 5, "confidence": 5}'
  )::jsonb,
  qualification_thresholds jsonb not null default (
    '{"hot": 80, "warm": 65, "nurture": 50}'
  )::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger icp_profiles_set_updated_at before update on public.icp_profiles
  for each row execute function public.set_updated_at();

alter table public.leads
  add constraint leads_icp_profile_fk foreign key (icp_profile_id) references public.icp_profiles (id);

-- CEO decisions on a `sales_lead` approval include Hold and "do not contact"
-- (spec §27-28), in addition to the existing approve/reject/revise outcomes
-- shared by every other approval type.
alter table public.approval_requests drop constraint approval_requests_status_check;
alter table public.approval_requests add constraint approval_requests_status_check check (status in (
  'pending', 'approved', 'rejected', 'revision_requested', 'hold', 'do_not_contact'
));

-- ============================================================
-- 3. do_not_contact
-- ============================================================
create table public.do_not_contact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_name text,
  normalized_company_name text,
  domain text,
  normalized_domain text,
  reason text not null,
  created_by_user_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index dnc_normalized_domain_idx on public.do_not_contact (tenant_id, normalized_domain);
create index dnc_normalized_name_idx on public.do_not_contact (tenant_id, normalized_company_name);

-- ============================================================
-- 4. lead_scores: full multi-axis breakdown per scoring event
-- ============================================================
create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  score_version text not null default 'v1',
  total numeric not null,
  qualification text not null check (qualification in ('HOT', 'WARM', 'NURTURE', 'LOW')),
  -- components: [{ key, label, score, max, reason }]
  components jsonb not null default '[]'::jsonb,
  created_by_agent_id uuid references public.agents (id),
  created_at timestamptz not null default now()
);

create index lead_scores_lead_idx on public.lead_scores (tenant_id, lead_id, created_at desc);

-- ============================================================
-- 5. lead_sales_hypotheses: merged Recommendation + Sales Hypothesis
-- ============================================================
create table public.lead_sales_hypotheses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,

  observed_problem text,
  business_impact text,
  why_now text,
  recommended_services jsonb not null default '[]'::jsonb, -- [{ service, reason }], max ~3
  expected_outcome text,
  confidence text check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  unknowns jsonb not null default '[]'::jsonb,
  next_information_needed text,

  estimated_initial_value numeric,
  estimated_monthly_value numeric,
  estimated_annual_value numeric,
  -- price_recommendation: { recommended_plan, standard_price, estimated_customization, estimated_total, reason }
  price_recommendation jsonb,

  critic_status text check (critic_status in ('PASS', 'REVISION_REQUIRED', 'BLOCKED')),
  critic_notes jsonb not null default '[]'::jsonb,
  revision_count integer not null default 0,

  prompt_version text not null default 'v1',
  created_by_agent_id uuid references public.agents (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lead_sales_hypotheses_set_updated_at before update on public.lead_sales_hypotheses
  for each row execute function public.set_updated_at();

create index lead_sales_hypotheses_lead_idx on public.lead_sales_hypotheses (tenant_id, lead_id, created_at desc);

-- ============================================================
-- 6. sales_drafts: outreach draft content (never sent automatically)
-- ============================================================
create table public.sales_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null check (channel in ('email', 'contact_form', 'linkedin', 'other')),
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'critic_review', 'revision_required', 'DRAFT_READY')),
  critic_status text check (critic_status in ('PASS', 'REVISION_REQUIRED', 'BLOCKED')),
  critic_notes jsonb not null default '[]'::jsonb,
  prompt_version text not null default 'v1',
  created_by_agent_id uuid references public.agents (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sales_drafts_set_updated_at before update on public.sales_drafts
  for each row execute function public.set_updated_at();

create index sales_drafts_lead_idx on public.sales_drafts (tenant_id, lead_id, created_at desc);

-- ============================================================
-- 7. RLS
-- ============================================================
alter table public.icp_profiles enable row level security;
alter table public.do_not_contact enable row level security;
alter table public.lead_scores enable row level security;
alter table public.lead_sales_hypotheses enable row level security;
alter table public.sales_drafts enable row level security;

do $$
declare
  t text;
  member_tables text[] := array[
    'icp_profiles', 'do_not_contact', 'lead_scores', 'lead_sales_hypotheses', 'sales_drafts'
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
-- 8. Agent roster: add Lead Scoring + Sales Writer agents
-- ============================================================
-- Extend the auto-provisioning trigger so every *new* tenant gets the two
-- additional AI Sales Department agents this phase introduces.
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

  insert into public.agents (tenant_id, code, name, role, job_title, description, avatar) values
    (new_tenant_id, 'rei', 'レイ', 'supervisor', 'AI統括', 'Business Orchestratorを監督するSupervisor Agent', 'rei'),
    (new_tenant_id, 'scout', 'スカウト', 'lead_discovery', 'Lead Discovery', '案件候補（Lead）の発見・登録を担当', 'scout'),
    (new_tenant_id, 'research', 'リサーチ', 'company_research', 'Company Research', '企業調査を実行', 'research'),
    (new_tenant_id, 'sales', 'セール', 'sales_strategy', 'Sales Strategy', '営業候補（提案の骨子）を作成', 'sales'),
    (new_tenant_id, 'sou', 'ソウ', 'website_diagnosis', 'Website Diagnosis', 'Webサイト診断を実行', 'sou'),
    (new_tenant_id, 'seo', 'セオ', 'seo', 'SEO', 'SEO施策を担当', 'seo'),
    (new_tenant_id, 'geo', 'ジオ', 'aio_geo', 'AIO / GEO / AEO', 'AI検索最適化を担当', 'geo'),
    (new_tenant_id, 'mina', 'ミナ', 'analytics', 'Analytics', '効果測定・分析を担当', 'mina'),
    (new_tenant_id, 'kei', 'ケイ', 'strategy', 'Strategy', '戦略立案を担当', 'kei'),
    (new_tenant_id, 'taku', 'タク', 'director', 'Director / Task Planner', 'タスク計画とディレクションを担当', 'taku'),
    (new_tenant_id, 'kuro', 'クロ', 'critic', 'Critic / AI監査', '他Agentの成果物をレビューし差し戻しを判断', 'kuro'),
    (new_tenant_id, 'qa', 'QA', 'qa', 'Quality Assurance', '最終品質チェックを担当', 'qa'),
    (new_tenant_id, 'repo', 'レポ', 'report', 'Report', '月次レポート作成を担当', 'repo'),
    (new_tenant_id, 'contract', '契約', 'contract_review', 'Contract Review', '契約書の抽出・リスク整理を担当', 'contract'),
    (new_tenant_id, 'scorer', 'スコア', 'lead_scoring', 'Lead Scoring', '案件化可能性を多軸スコアで評価', 'scorer'),
    (new_tenant_id, 'writer', 'ライター', 'sales_writer', 'Sales Writer', '営業文・提案草案を作成（送信は行わない）', 'writer');

  select id into agent_rei from public.agents where tenant_id = new_tenant_id and code = 'rei';

  insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
  select new_tenant_id, a.id, dept_sales
  from public.agents a
  where a.tenant_id = new_tenant_id and a.code in ('scout', 'research', 'sales', 'scorer', 'writer');

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

  -- Starter ICP (spec §4 example: "成長中BtoB企業"). Not restrictive by
  -- default (no industry/region limits) so the vertical slice works
  -- out of the box; the tenant can narrow it from ICP Settings.
  insert into public.icp_profiles (
    tenant_id, name, is_default, target_industries, target_regions, employee_size_min, employee_size_max,
    business_model, requires_website, target_services, target_price_floor, exclusion_conditions
  ) values (
    new_tenant_id, '成長中BtoB企業', true, '[]'::jsonb, '["全国"]'::jsonb, 10, 300,
    'b2b', true, '["SEO", "AIO", "GEO"]'::jsonb, 200000, '[]'::jsonb
  );

  return new;
end;
$$;

-- Backfill: give every *existing* tenant the two new agents too, so this
-- phase doesn't only apply to tenants created after today.
do $$
declare
  tenant_row record;
  dept_sales uuid;
begin
  for tenant_row in select id from public.tenants loop
    insert into public.agents (tenant_id, code, name, role, job_title, description, avatar)
    values
      (tenant_row.id, 'scorer', 'スコア', 'lead_scoring', 'Lead Scoring', '案件化可能性を多軸スコアで評価', 'scorer'),
      (tenant_row.id, 'writer', 'ライター', 'sales_writer', 'Sales Writer', '営業文・提案草案を作成（送信は行わない）', 'writer')
    on conflict (tenant_id, code) do nothing;

    select id into dept_sales from public.departments where tenant_id = tenant_row.id and code = 'sales';
    if dept_sales is not null then
      insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
      select tenant_row.id, a.id, dept_sales
      from public.agents a
      where a.tenant_id = tenant_row.id and a.code in ('scorer', 'writer')
      on conflict (agent_id, department_id) do nothing;
    end if;

    if not exists (select 1 from public.icp_profiles where tenant_id = tenant_row.id) then
      insert into public.icp_profiles (
        tenant_id, name, is_default, target_industries, target_regions, employee_size_min, employee_size_max,
        business_model, requires_website, target_services, target_price_floor, exclusion_conditions
      ) values (
        tenant_row.id, '成長中BtoB企業', true, '[]'::jsonb, '["全国"]'::jsonb, 10, 300,
        'b2b', true, '["SEO", "AIO", "GEO"]'::jsonb, 200000, '[]'::jsonb
      );
    end if;
  end loop;
end $$;
