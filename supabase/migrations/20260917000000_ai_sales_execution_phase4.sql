-- AI Company OS: Phase 4 — AI Sales Execution / Meetings / Proposals / Estimates / Won-Lost
--
-- Design note (avoiding unnecessary table splits, per the product brief):
--   * Email content structure, send status, reply classification, and
--     thread linkage are all columns on ONE `sales_messages` table (per the
--     brief's own §14 instruction) rather than separate tables for drafts /
--     classifications / thread mappings.
--   * Meeting participants, agenda, and minutes are jsonb columns on
--     `meetings` rather than `meeting_participants` / `meeting_minutes`
--     tables. Action items live inside `meetings.minutes->actionItems`
--     (each `{title, owner, dueDate, status}`) rather than a
--     `meeting_action_items` table: `tasks.project_id` is NOT NULL and no
--     project exists yet at the Opportunity stage, so a real Task can only
--     be created once WON -> Contract -> Onboarding creates one; until then
--     these stay human-reviewable structured data on the meeting itself
--     (see README "Known limitations").
--   * Proposal/Estimate versioning is `version integer` + `previous_version_id`
--     self-reference on the same table, not a separate `proposal_versions` /
--     `estimate_versions` history table.
--   * Negotiation reactions reuse the existing `findings` table
--     (type = 'negotiation_item') instead of a new `negotiation_items` table.
--   * Opportunity stage history reuses the existing `agent_events` table
--     (event_type = 'opportunity.stage_changed') instead of a new
--     `opportunity_stage_history` table.
--   * The final "WON" decision reuses the *existing* `sales_outreach`
--     approval type's underlying finalize-and-start-contract logic (a new
--     `deal_won` approval type triggers the same `finalizeWonAndStartContract`
--     helper) so the already-built `sales_graph` -> `contract_graph` chain
--     from Phase 1 is reused unchanged, per the brief's explicit instruction
--     to connect back into the existing Contract Workflow (§56).
--
-- New tables kept distinct because they are genuinely independent entities:
-- sales_conversations, sales_messages, meetings, proposals, estimates,
-- service_catalog, external_action_logs.

-- ============================================================
-- 1. opportunities: promote to the real Sales Pipeline entity (spec §32-33)
-- ============================================================
alter table public.opportunities
  add column probability integer check (probability between 0 and 100),
  add column estimated_value numeric,
  add column confirmed_value numeric,
  add column expected_close_date date,
  add column owner_user_id uuid references auth.users (id),
  add column services jsonb not null default '[]'::jsonb,
  add column decision_maker text,
  add column budget text,
  add column need text,
  add column timeline text,
  add column next_action text,
  add column next_action_date timestamptz,
  -- Extensible Qualification Framework (spec §28): kept as jsonb precisely so
  -- MEDDIC/BANT/whatever a tenant prefers can change later without a schema
  -- migration. decision_maker/budget/need/timeline above are the simple
  -- convenience fields the spec also asks for at the top level.
  add column qualification jsonb not null default '{}'::jsonb,
  add column lost_reason text check (lost_reason in (
    'competitor', 'price_issue', 'timing', 'no_budget', 'no_need', 'internal_issue', 'unknown', 'other'
  )),
  add column lost_detail text,
  add column ai_cost_yen numeric not null default 0,
  add column test_mode boolean not null default false;

-- `stage` already exists (text, default 'candidate', no prior check) from
-- Phase 1's lead_generation_graph, which never advances it past 'candidate'.
-- Widen it to the full Phase 4 pipeline without breaking that legacy value.
alter table public.opportunities add constraint opportunities_stage_check check (stage in (
  'candidate', 'QUALIFIED', 'MEETING', 'NEEDS_ANALYSIS', 'PROPOSAL_PREPARATION', 'PROPOSAL_SENT',
  'NEGOTIATION', 'VERBAL_AGREEMENT', 'WON', 'LOST', 'ON_HOLD'
));

create index opportunities_lead_idx on public.opportunities (tenant_id, lead_id);

-- ============================================================
-- 2. sales_conversations / sales_messages (spec §14, §6, §12, §84)
-- ============================================================
create table public.sales_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  channel text not null check (channel in ('EMAIL', 'FORM', 'PHONE', 'MEETING', 'OTHER')),
  status text not null default 'active' check (status in ('active', 'closed')),
  owner_agent_id uuid references public.agents (id),
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sales_conversations_set_updated_at before update on public.sales_conversations
  for each row execute function public.set_updated_at();

create index sales_conversations_lead_idx on public.sales_conversations (tenant_id, lead_id);

create table public.sales_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  conversation_id uuid not null references public.sales_conversations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  opportunity_id uuid references public.opportunities (id) on delete set null,

  direction text not null check (direction in ('OUTBOUND', 'INBOUND')),
  channel text not null check (channel in ('EMAIL', 'FORM', 'PHONE', 'MEETING', 'OTHER')),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'WAITING_REVIEW', 'WAITING_APPROVAL', 'APPROVED', 'READY_TO_SEND',
    'SENT', 'DELIVERED', 'REPLIED', 'FAILED', 'BOUNCED', 'CANCELLED'
  )),

  -- Structured email content (spec §6) — never just a text blob.
  subject text,
  to_address text,
  recipient_name text,
  opening text,
  personalized_observation text,
  problem_hypothesis text,
  value_proposition text,
  evidence jsonb not null default '[]'::jsonb, -- [{ sourceUrl, capturedAt, evidence }] (spec §8)
  cta text,
  signature text,
  body text, -- full rendered content

  critic_status text check (critic_status in ('PASS', 'REVISION_REQUIRED', 'BLOCKED')),
  critic_notes jsonb not null default '[]'::jsonb,
  revision_count integer not null default 0,

  -- Inbound reply classification (spec §16-17).
  reply_classification text check (reply_classification in (
    'POSITIVE', 'INTERESTED', 'MEETING_REQUEST', 'QUESTION', 'PRICE_QUESTION', 'NOT_NOW',
    'REFERRAL', 'NOT_INTERESTED', 'DO_NOT_CONTACT', 'AUTO_REPLY', 'BOUNCE', 'UNKNOWN'
  )),
  reply_confidence numeric,
  reply_priority text check (reply_priority in ('P0', 'P1', 'P2')),

  -- Send idempotency + provider linkage (spec §12, §81-84).
  idempotency_key text,
  provider text,
  provider_draft_id text,
  provider_message_id text,
  provider_thread_id text,
  in_reply_to text,
  error_code text,
  error_message text,
  retryable boolean,
  sent_at timestamptz,
  delivered_at timestamptz,

  approval_request_id uuid references public.approval_requests (id),
  created_by_agent_id uuid references public.agents (id),
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, idempotency_key)
);

create trigger sales_messages_set_updated_at before update on public.sales_messages
  for each row execute function public.set_updated_at();

create index sales_messages_conversation_idx on public.sales_messages (tenant_id, conversation_id, created_at);
create index sales_messages_lead_idx on public.sales_messages (tenant_id, lead_id);

-- ============================================================
-- 3. meetings (spec §21-31)
-- ============================================================
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid references public.clients (id),
  lead_id uuid references public.leads (id),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,

  title text not null,
  meeting_type text not null default 'discovery',
  status text not null default 'PROPOSED' check (status in (
    'PROPOSED', 'SCHEDULING', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
  )),

  candidate_times jsonb not null default '[]'::jsonb, -- AI-proposed slots, human picks one
  scheduled_at timestamptz,
  duration_minutes integer,
  participants jsonb not null default '[]'::jsonb, -- [{ name, email, role }]
  agenda jsonb not null default '[]'::jsonb, -- human-editable draft agenda

  meeting_url text,
  calendar_event_id text,
  calendar_provider text,

  transcript_status text not null default 'NONE' check (transcript_status in ('NONE', 'PROVIDED', 'PROCESSED')),
  transcript text,
  -- minutes: { summary, clientNeeds, goals, kpis, budget, authority, timing,
  --            decisions, questions, concerns, risks, actionItems, nextStep }
  -- Unknown fields are the literal strings UNASSIGNED/UNSET/UNKNOWN, never a
  -- guess (spec §30 — no meeting hallucination).
  minutes jsonb,
  minutes_status text check (minutes_status in ('DRAFT', 'HUMAN_REVIEWED')),

  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger meetings_set_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();

create index meetings_opportunity_idx on public.meetings (tenant_id, opportunity_id, created_at);

-- ============================================================
-- 4. proposals (spec §35-39, §47-50)
-- ============================================================
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,

  version integer not null default 1,
  previous_version_id uuid references public.proposals (id),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'INTERNAL_REVIEW', 'WAITING_APPROVAL', 'APPROVED', 'SENT',
    'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'EXPIRED'
  )),

  title text,
  executive_summary text,
  client_challenges jsonb not null default '[]'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  recommended_solution text,
  scope jsonb not null default '[]'::jsonb,
  deliverables jsonb not null default '[]'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  kpis jsonb not null default '[]'::jsonb,
  -- price_summary is a snapshot of the linked estimate at approval time
  -- (spec §37/§50: changing the proposal later must not change what was sent).
  price_summary jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  next_step text,

  critic_status text check (critic_status in ('PASS', 'REVISION_REQUIRED', 'BLOCKED')),
  critic_notes jsonb not null default '[]'::jsonb,
  revision_count integer not null default 0,

  created_by_agent_id uuid references public.agents (id),
  approved_by_user_id uuid references auth.users (id),
  sent_at timestamptz,
  sent_to text,
  prompt_version text not null default 'v1',
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger proposals_set_updated_at before update on public.proposals
  for each row execute function public.set_updated_at();

create index proposals_opportunity_idx on public.proposals (tenant_id, opportunity_id, created_at desc);

-- ============================================================
-- 5. estimates (spec §40-45)
-- ============================================================
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,

  version integer not null default 1,
  previous_version_id uuid references public.estimates (id),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'
  )),

  line_items jsonb not null default '[]'::jsonb, -- [{ service, quantity, unitPrice, discount, amount, catalogCode }]
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  discount_reason text,
  tax numeric not null default 0,
  total numeric not null default 0,
  setup_fee numeric not null default 0,
  monthly_fee numeric not null default 0,
  annual_value numeric,
  valid_until date,
  payment_terms text,
  notes text,

  -- Internal-only margin (spec §45-46) — never exposed to a client-facing view.
  estimated_hours numeric,
  internal_cost numeric,
  margin_amount numeric,
  margin_rate numeric,

  created_by_agent_id uuid references public.agents (id),
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger estimates_set_updated_at before update on public.estimates
  for each row execute function public.set_updated_at();

create index estimates_opportunity_idx on public.estimates (tenant_id, opportunity_id, created_at desc);

-- ============================================================
-- 6. service_catalog: Price Master (spec §41) — AI never invents a price
-- ============================================================
create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  name text not null,
  category text,
  pricing_model text not null default 'monthly' check (pricing_model in ('one_time', 'monthly', 'usage')),
  standard_price numeric not null,
  setup_fee numeric not null default 0,
  unit text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create trigger service_catalog_set_updated_at before update on public.service_catalog
  for each row execute function public.set_updated_at();

-- ============================================================
-- 7. external_action_logs (spec §76, §79, §98)
-- ============================================================
create table public.external_action_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  action_type text not null check (action_type in ('EMAIL_SEND', 'CALENDAR_CREATE', 'FILE_SHARE', 'PROPOSAL_DELIVERY')),
  subject_type text not null,
  subject_id uuid not null,
  -- External actions are always human-gated (spec §0) — this is never null.
  performed_by_user_id uuid not null references auth.users (id),
  provider text,
  provider_ref text,
  idempotency_key text,
  status text not null default 'SUCCESS' check (status in ('SUCCESS', 'FAILED')),
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  test_mode boolean not null default false,
  created_at timestamptz not null default now()
);

create index external_action_logs_subject_idx on public.external_action_logs (tenant_id, subject_type, subject_id);

-- ============================================================
-- 8. RLS
-- ============================================================
alter table public.sales_conversations enable row level security;
alter table public.sales_messages enable row level security;
alter table public.meetings enable row level security;
alter table public.proposals enable row level security;
alter table public.estimates enable row level security;
alter table public.service_catalog enable row level security;
alter table public.external_action_logs enable row level security;

do $$
declare
  t text;
  member_tables text[] := array[
    'sales_conversations', 'sales_messages', 'meetings', 'proposals', 'estimates',
    'service_catalog', 'external_action_logs'
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
-- 9. Agent roster: add the AI Sales Execution agents + capabilities
-- ============================================================
-- capabilities (spec §2: names/count must not be hardcoded, workflow selects
-- by capability). Existing agents also get a capabilities tag retroactively
-- so capability-based lookup works uniformly across the whole roster.
update public.agents set capabilities = '["critic_review"]'::jsonb where code = 'kuro' and capabilities = '[]'::jsonb;
update public.agents set capabilities = '["sales_coordination", "sales_strategy"]'::jsonb where code = 'sales' and capabilities = '[]'::jsonb;
update public.agents set capabilities = '["supervision"]'::jsonb where code = 'rei' and capabilities = '[]'::jsonb;

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

  return new;
end;
$$;

-- Backfill: existing tenants get the new agents, department assignments,
-- and starter price catalog too.
do $$
declare
  tenant_row record;
  dept_sales uuid;
begin
  for tenant_row in select id from public.tenants loop
    insert into public.agents (tenant_id, code, name, role, job_title, description, avatar, capabilities)
    values
      (tenant_row.id, 'outreach', 'アウトリーチ', 'sales_outreach', 'Sales Outreach', '営業文作成・チャネル選定（送信は行わない）', 'outreach', '["sales_outreach", "channel_selection", "email_draft"]'::jsonb),
      (tenant_row.id, 'analyst', 'アナリスト', 'response_analysis', 'Response Analyst', '返信の分類・返信案作成', 'analyst', '["reply_classification", "reply_draft"]'::jsonb),
      (tenant_row.id, 'meeting', 'ミーティング', 'meeting_coordination', 'Meeting Coordinator', '商談日程調整・準備・議事録Draft', 'meeting', '["meeting_scheduling", "meeting_prep", "meeting_minutes"]'::jsonb),
      (tenant_row.id, 'proposal', 'プロポーザル', 'proposal_writer', 'Proposal Agent', '提案書Draft作成', 'proposal', '["proposal_draft"]'::jsonb),
      (tenant_row.id, 'estimate', 'エスティメイト', 'estimate_writer', 'Estimate Agent', '見積Draft作成（価格マスタ参照）', 'estimate', '["estimate_draft", "pricing"]'::jsonb),
      (tenant_row.id, 'negotiator', 'ネゴシエーター', 'negotiation_support', 'Negotiation Agent', '交渉論点の整理（値引き確定は行わない）', 'negotiator', '["negotiation_analysis"]'::jsonb)
    on conflict (tenant_id, code) do nothing;

    select id into dept_sales from public.departments where tenant_id = tenant_row.id and code = 'sales';
    if dept_sales is not null then
      insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
      select tenant_row.id, a.id, dept_sales
      from public.agents a
      where a.tenant_id = tenant_row.id and a.code in ('outreach', 'analyst', 'meeting', 'proposal', 'estimate', 'negotiator')
      on conflict (agent_id, department_id) do nothing;
    end if;

    if not exists (select 1 from public.service_catalog where tenant_id = tenant_row.id) then
      insert into public.service_catalog (tenant_id, code, name, category, pricing_model, standard_price, setup_fee, unit, description) values
        (tenant_row.id, 'SEO', 'SEO Standard', 'SEO', 'monthly', 248000, 0, '月', '検索エンジン最適化の標準プラン'),
        (tenant_row.id, 'AIO', 'AIO/GEO Standard', 'AIO', 'monthly', 198000, 50000, '月', 'AI検索最適化(AIO/GEO/AEO)の標準プラン'),
        (tenant_row.id, 'CRO', 'CRO Standard', 'CRO', 'monthly', 158000, 0, '月', '問い合わせ導線改善(CRO)の標準プラン'),
        (tenant_row.id, 'Web Renewal', 'Webサイトリニューアル', 'Production', 'one_time', 980000, 0, '式', 'サイト刷新一式');
    end if;
  end loop;
end $$;
