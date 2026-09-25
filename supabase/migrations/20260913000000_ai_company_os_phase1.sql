-- AI Company OS: Phase 1 schema
-- Adds multi-tenant Company/Agent/Sales/Contract/Project/Workflow domain on top of
-- the existing YATTORU tables (public.users / daily_tasks / daily_logs), which are
-- left untouched.
--
-- Design:
--   * Every business table carries tenant_id and is protected by RLS via
--     public.is_tenant_member(tenant_id) / public.has_tenant_role(tenant_id, roles).
--   * tenant_id is NEVER trusted from client input at the application layer:
--     server code resolves it from the authenticated user's membership row.
--   * Departments and Agents are pure data (no hardcoded names in application code).
--     A new tenant is auto-seeded with a starter department/agent roster on signup.
--   * workflow_checkpoints / workflow_checkpoint_writes back a custom LangGraph.js
--     BaseCheckpointSaver so graph execution survives reloads/process restarts.

create extension if not exists "pgcrypto";

-- ============================================================
-- 0. Helper: updated_at maintenance
-- ============================================================
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 1. Tenancy
-- ============================================================
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'ceo', 'admin', 'member')) default 'member',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);

-- Security-definer helpers used throughout RLS policies below.
-- `stable` + security definer so they can read memberships regardless of the
-- calling role's own RLS visibility, without exposing memberships directly.
create function public.is_tenant_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = target_tenant and m.user_id = auth.uid()
  );
$$;

create function public.has_tenant_role(target_tenant uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = target_tenant
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;

create policy "tenants_select_member" on public.tenants
  for select using (public.is_tenant_member(id));

create policy "memberships_select_own_tenant" on public.memberships
  for select using (public.is_tenant_member(tenant_id));

-- ============================================================
-- 2. Organization / Department / Agent
-- ============================================================
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  name text not null,
  role text not null,
  job_title text,
  description text,
  capabilities jsonb not null default '[]'::jsonb,
  provider text not null default 'template',
  model text,
  prompt_version text not null default 'v1',
  status text not null default 'idle' check (status in (
    'idle', 'queued', 'thinking', 'working', 'tool_calling', 'waiting_external',
    'waiting_human', 'reviewing', 'handoff', 'completed', 'warning', 'failed'
  )),
  current_project_id uuid,
  current_task_id uuid,
  avatar text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create trigger agents_set_updated_at before update on public.agents
  for each row execute function public.set_updated_at();

create table public.agent_department_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (agent_id, department_id)
);

-- ============================================================
-- 3. Sales domain: Client / Lead / Opportunity / Contract
-- ============================================================
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  industry text,
  website text,
  contact_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_name text not null,
  industry text,
  website text,
  contact_info jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  status text not null default 'new' check (status in (
    'new', 'researching', 'researched', 'scored', 'sales_drafted',
    'in_review', 'approved', 'rejected', 'won', 'lost'
  )),
  score numeric,
  created_by_agent_id uuid references public.agents (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger leads_set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  client_id uuid references public.clients (id),
  stage text not null default 'candidate',
  amount numeric,
  currency text not null default 'JPY',
  sales_agent_id uuid references public.agents (id),
  notes text,
  status text not null default 'open' check (status in (
    'open', 'pending_approval', 'approved', 'won', 'lost'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger opportunities_set_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  terms jsonb not null default '{}'::jsonb,
  risk_level text check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  risk_findings jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'rejected'
  )),
  reviewed_by_agent_id uuid references public.agents (id),
  approved_by_user_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contracts_set_updated_at before update on public.contracts
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. Delivery domain: Project / Goal / KPI / Team / Task / Deliverable
-- ============================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contract_id uuid references public.contracts (id),
  client_id uuid references public.clients (id),
  name text not null,
  project_type text not null default 'general',
  status text not null default 'active' check (status in ('active', 'completed', 'delivered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  target_value numeric,
  unit text,
  due_date date,
  created_at timestamptz not null default now()
);

create table public.kpis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  goal_id uuid references public.goals (id),
  name text not null,
  current_value numeric,
  target_value numeric,
  unit text,
  measured_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.project_team_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  role_in_project text not null default 'contributor',
  assigned_at timestamptz not null default now(),
  unique (project_id, agent_id)
);

create table public.initiatives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  agent_id uuid references public.agents (id),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text,
  assigned_agent_id uuid references public.agents (id),
  status text not null default 'todo' check (status in (
    'todo', 'in_progress', 'in_review', 'qa', 'done', 'blocked'
  )),
  sequence integer not null default 0,
  depends_on uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id),
  title text not null,
  type text not null default 'document',
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in (
    'draft', 'in_review', 'approved', 'delivered'
  )),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 5. Human Approval (single shared mechanism for all domains)
-- ============================================================
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null,
  subject_type text not null,
  subject_id uuid not null,
  title text not null,
  description text,
  risk_level text,
  ai_recommendation text,
  requested_by_agent_id uuid references public.agents (id),
  status text not null default 'pending' check (status in (
    'pending', 'approved', 'rejected', 'revision_requested'
  )),
  decided_by_user_id uuid references auth.users (id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index approval_requests_tenant_status_idx on public.approval_requests (tenant_id, status);

create trigger approval_requests_set_updated_at before update on public.approval_requests
  for each row execute function public.set_updated_at();

create table public.decision_memories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  approval_request_id uuid references public.approval_requests (id) on delete set null,
  category text not null,
  note text not null,
  created_by_user_id uuid references auth.users (id),
  rule_candidate boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 6. Workflow / Agent execution / Events
-- ============================================================
create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  graph_name text not null,
  subject_type text not null,
  subject_id uuid not null,
  status text not null default 'running' check (status in (
    'running', 'waiting_human', 'completed', 'failed'
  )),
  current_node text,
  thread_id uuid not null default gen_random_uuid(),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workflow_runs_subject_idx on public.workflow_runs (tenant_id, subject_type, subject_id);

create trigger workflow_runs_set_updated_at before update on public.workflow_runs
  for each row execute function public.set_updated_at();

-- Backing store for a custom LangGraph.js BaseCheckpointSaver (mirrors the
-- shape of the official MemorySaver, persisted instead of held in process memory).
create table public.workflow_checkpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workflow_run_id uuid not null references public.workflow_runs (id) on delete cascade,
  thread_id text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  parent_checkpoint_id text,
  checkpoint jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (thread_id, checkpoint_ns, checkpoint_id)
);

create index workflow_checkpoints_thread_idx on public.workflow_checkpoints (thread_id, checkpoint_ns, checkpoint_id desc);

create table public.workflow_checkpoint_writes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  thread_id text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  task_id text not null,
  idx integer not null,
  channel text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  unique (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs (id) on delete cascade,
  agent_id uuid not null references public.agents (id),
  node_name text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create index agent_runs_tenant_agent_idx on public.agent_runs (tenant_id, agent_id, started_at desc);

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs (id) on delete cascade,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  event_type text not null,
  from_agent_id uuid references public.agents (id),
  to_agent_id uuid references public.agents (id),
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index agent_events_tenant_created_idx on public.agent_events (tenant_id, created_at desc);

create table public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  agent_run_id uuid not null references public.agent_runs (id) on delete cascade,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7. RLS: tenant-membership based access for every business table
-- ============================================================
alter table public.departments enable row level security;
alter table public.agents enable row level security;
alter table public.agent_department_assignments enable row level security;
alter table public.clients enable row level security;
alter table public.leads enable row level security;
alter table public.opportunities enable row level security;
alter table public.contracts enable row level security;
alter table public.projects enable row level security;
alter table public.goals enable row level security;
alter table public.kpis enable row level security;
alter table public.project_team_members enable row level security;
alter table public.initiatives enable row level security;
alter table public.findings enable row level security;
alter table public.tasks enable row level security;
alter table public.deliverables enable row level security;
alter table public.approval_requests enable row level security;
alter table public.decision_memories enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_checkpoints enable row level security;
alter table public.workflow_checkpoint_writes enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_events enable row level security;
alter table public.tool_calls enable row level security;

-- Generic "member can read/write everything within their tenant" policy,
-- applied per table. Writes are further scoped in application code (server
-- routes decide *when* to write); RLS is the hard tenant boundary.
do $$
declare
  t text;
  member_tables text[] := array[
    'departments', 'agents', 'agent_department_assignments', 'clients', 'leads',
    'opportunities', 'contracts', 'projects', 'goals', 'kpis',
    'project_team_members', 'initiatives', 'findings', 'tasks', 'deliverables',
    'workflow_runs', 'workflow_checkpoints', 'workflow_checkpoint_writes',
    'agent_runs', 'agent_events', 'tool_calls'
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

-- approval_requests: any member can read/create; only owner/ceo/admin can decide.
create policy "approval_requests_select_member" on public.approval_requests
  for select using (public.is_tenant_member(tenant_id));

create policy "approval_requests_insert_member" on public.approval_requests
  for insert with check (public.is_tenant_member(tenant_id));

create policy "approval_requests_decide_admin" on public.approval_requests
  for update using (public.has_tenant_role(tenant_id, array['owner', 'ceo', 'admin']))
  with check (public.has_tenant_role(tenant_id, array['owner', 'ceo', 'admin']));

-- decision_memories: member can read/insert, append-only (no update/delete policy).
create policy "decision_memories_select_member" on public.decision_memories
  for select using (public.is_tenant_member(tenant_id));

create policy "decision_memories_insert_member" on public.decision_memories
  for insert with check (public.is_tenant_member(tenant_id));

-- ============================================================
-- 8. Tenant auto-provisioning on signup + starter roster seed
-- ============================================================
-- Fires after the existing public.users row is created (see
-- 20260722000000_init_schema.sql `handle_new_user`), giving every new
-- signup their own tenant ("Company OS" is multi-tenant from day one) with
-- a starter department/agent roster. Agent names/roles live here in data,
-- never hardcoded in application code, and admins can add more later.
create function public.handle_new_tenant_for_user()
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
    (new_tenant_id, 'contract', '契約', 'contract_review', 'Contract Review', '契約書の抽出・リスク整理を担当', 'contract');

  select id into agent_rei from public.agents where tenant_id = new_tenant_id and code = 'rei';

  insert into public.agent_department_assignments (tenant_id, agent_id, department_id)
  select new_tenant_id, a.id, dept_sales
  from public.agents a
  where a.tenant_id = new_tenant_id and a.code in ('scout', 'research', 'sales');

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

  return new;
end;
$$;

create trigger on_user_created_provision_tenant
  after insert on public.users
  for each row execute function public.handle_new_tenant_for_user();
