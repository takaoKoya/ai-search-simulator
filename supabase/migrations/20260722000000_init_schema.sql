-- YATTORU: 初期スキーマ (users / daily_tasks / daily_logs)

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. users: auth.users に対応するプロフィールテーブル
-- ============================================================
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- auth.users への新規登録時に public.users へ自動でプロフィール行を作成する
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. daily_tasks: ユーザーに1日1つ割り当てられるタスク
-- ============================================================
create table public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  task_date date not null,
  title text not null,
  estimated_minutes integer not null,
  checklist jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_date)
);

create index daily_tasks_user_date_idx on public.daily_tasks (user_id, task_date);

-- ============================================================
-- 3. daily_logs: タスクに対するユーザーの行動ログ（追記のみ）
-- ============================================================
create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  daily_task_id uuid not null references public.daily_tasks (id) on delete cascade,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index daily_logs_task_idx on public.daily_logs (daily_task_id);

-- ============================================================
-- RLS: すべてのテーブルで本人の行のみアクセス可能にする
-- ============================================================
alter table public.users enable row level security;
alter table public.daily_tasks enable row level security;
alter table public.daily_logs enable row level security;

-- users: 参照・更新のみ許可。行の作成はトリガー(security definer)経由のみとし、
-- ユーザーからの直接INSERT/DELETEは許可しない。
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- daily_tasks: 本人の行のみ CRUD 可能
create policy "daily_tasks_select_own" on public.daily_tasks
  for select using (auth.uid() = user_id);

create policy "daily_tasks_insert_own" on public.daily_tasks
  for insert with check (auth.uid() = user_id);

create policy "daily_tasks_update_own" on public.daily_tasks
  for update using (auth.uid() = user_id);

create policy "daily_tasks_delete_own" on public.daily_tasks
  for delete using (auth.uid() = user_id);

-- daily_logs: 本人の行のみ 参照・作成可能。ログは追記のみとし update/delete は許可しない。
create policy "daily_logs_select_own" on public.daily_logs
  for select using (auth.uid() = user_id);

create policy "daily_logs_insert_own" on public.daily_logs
  for insert with check (auth.uid() = user_id);
