-- note Growth OS: 初期スキーマ (gos_ プレフィックス)
-- 既存の public.users / auth.users / daily_tasks / daily_logs は変更しない。
-- 命名を gos_ プレフィックスで分離しているのは、将来このプロダクトだけを
-- 別リポジトリ/別Supabaseプロジェクトへ切り出す場合の移行コストを下げるため。

-- ============================================================
-- 0. 共通: updated_at 自動更新トリガー関数
-- ============================================================
create or replace function public.gos_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 1. gos_research_items: 市場調査メモ
-- ============================================================
create table public.gos_research_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source text not null,
  source_url text,
  keyword text,
  title text not null,
  summary text,
  target_age text,
  -- 単一分類ではなく配列にし、「会社依存」のような複合的な悩みを
  -- 複数のHARM区分(Health/Ambition/Relation/Money)に跨って表現できるようにする。
  harm_type text[] not null default '{}',
  trend_score numeric check (trend_score is null or (trend_score between 0 and 100)),
  pain_score numeric check (pain_score is null or (pain_score between 0 and 100)),
  status text not null default 'NEW' check (status in ('NEW', 'REVIEWED', 'PROMOTED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_research_items_user_idx on public.gos_research_items (user_id, created_at desc);

create trigger gos_research_items_set_updated_at
  before update on public.gos_research_items
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 2. gos_content_ideas: 9軸スコアリング済みコンテンツ候補
-- ============================================================
create table public.gos_content_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  research_item_id uuid references public.gos_research_items (id) on delete set null,
  title text not null,
  summary text,
  -- [{criterion, weight, score, reasoning}, ...] 9軸すべてを保持
  score_breakdown jsonb not null default '[]'::jsonb,
  total_score numeric not null default 0 check (total_score between 0 and 100),
  tier text generated always as (
    case
      when total_score >= 90 then 'TOP'
      when total_score >= 85 then 'CANDIDATE'
      when total_score >= 75 then 'HOLD'
      else 'REJECT'
    end
  ) stored,
  status text not null default 'NEW' check (status in (
    'NEW', 'APPROVED_FOR_THREADS', 'APPROVED_FOR_NOTE_FREE', 'APPROVED_FOR_NOTE_PAID', 'ON_HOLD', 'REJECTED'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_content_ideas_user_idx on public.gos_content_ideas (user_id, total_score desc);

create trigger gos_content_ideas_set_updated_at
  before update on public.gos_content_ideas
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 3. gos_threads_posts: 1テーマ→5パターン
-- ============================================================
create table public.gos_threads_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  idea_id uuid not null references public.gos_content_ideas (id) on delete cascade,
  pattern_type text not null check (pattern_type in ('EMPATHY', 'PROBLEM', 'FAILURE', 'QUESTION', 'CONTRARIAN')),
  body text not null default '',
  -- {ai_smell, sales_smell, preachy, hype, humanity, empathy} 各0-100
  tone_scores jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'PUBLISHED', 'REJECTED')),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_threads_posts_idea_idx on public.gos_threads_posts (idea_id);
create index gos_threads_posts_user_idx on public.gos_threads_posts (user_id, status);

create trigger gos_threads_posts_set_updated_at
  before update on public.gos_threads_posts
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 4. gos_note_articles: note記事(FREE/PAID)とAIパイプライン進捗
-- ============================================================
create table public.gos_note_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  idea_id uuid references public.gos_content_ideas (id) on delete set null,
  type text not null check (type in ('FREE', 'PAID')),
  price integer check (price is null or price >= 0),
  title text not null default '',
  body_markdown text not null default '',
  current_stage text not null default 'RESEARCH' check (current_stage in (
    'RESEARCH', 'PLANNING', 'WRITING', 'READER_REVIEW', 'CHIEF_EDIT', 'FACT_CHECK', 'SALES_EDIT', 'DONE'
  )),
  -- 品質スコア80点未満の自動修正は最大3回までとし、無限ループを禁止する。
  -- アプリ側のバグに備え、check制約でも上限をDBレベルで強制する。
  revision_count integer not null default 0 check (revision_count between 0 and 3),
  quality_score numeric check (quality_score is null or (quality_score between 0 and 100)),
  quality_below_threshold boolean not null default false,
  status text not null default 'IDEA' check (status in (
    'IDEA', 'RESEARCHED', 'DRAFT', 'AI_REVIEWED', 'WAITING_APPROVAL', 'APPROVED', 'PUBLISHED', 'ANALYZED'
  )),
  published_at timestamptz,
  note_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_note_articles_user_idx on public.gos_note_articles (user_id, status);

create trigger gos_note_articles_set_updated_at
  before update on public.gos_note_articles
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 5. gos_ai_reviews: Agentごとの評価履歴(追記のみ、上書き禁止)
-- ============================================================
create table public.gos_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  target_type text not null check (target_type in ('RESEARCH_ITEM', 'IDEA', 'THREADS_POST', 'NOTE_ARTICLE')),
  target_id uuid not null,
  agent_type text not null check (agent_type in (
    'RESEARCH_CLASSIFIER', 'IDEA_SCORER', 'THREADS_GENERATOR', 'THREADS_TONE_ANALYZER',
    'RESEARCH_AGENT', 'PLANNING_AGENT', 'WRITER_AGENT', 'READER_50S_AGENT',
    'CHIEF_EDITOR_AGENT', 'FACT_CHECK_AGENT', 'SALES_EDITOR_AGENT',
    'PRODUCT_SUGGESTER', 'ANALYTICS_ADVISOR'
  )),
  revision_number integer not null default 0,
  score numeric,
  verdict text check (verdict in ('PASS', 'NEEDS_REVISION', 'FAIL')),
  feedback text,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index gos_ai_reviews_target_idx on public.gos_ai_reviews (target_type, target_id, created_at desc);

-- ============================================================
-- 6. gos_products: 商品化提案
-- ============================================================
create table public.gos_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source_content_id uuid references public.gos_note_articles (id) on delete set null,
  product_name text not null,
  recommended_price integer,
  target text,
  problem text,
  solution text,
  product_score numeric check (product_score is null or (product_score between 0 and 100)),
  outline jsonb,
  status text not null default 'PROPOSED' check (status in (
    'PROPOSED', 'IN_DEVELOPMENT', 'READY', 'LAUNCHED', 'ARCHIVED'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_products_user_idx on public.gos_products (user_id, status);

create trigger gos_products_set_updated_at
  before update on public.gos_products
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 7. gos_content_metrics: 日次成果スナップショット
-- ============================================================
create table public.gos_content_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  content_type text not null check (content_type in ('THREADS_POST', 'NOTE_ARTICLE', 'PRODUCT')),
  content_id uuid not null,
  metric_date date not null,
  pv integer not null default 0,
  likes integer not null default 0,
  like_rate numeric,
  follower_delta integer not null default 0,
  sales_amount numeric not null default 0,
  purchase_count integer not null default 0,
  theme_tag text,
  created_at timestamptz not null default now(),
  unique (content_id, metric_date)
);

create index gos_content_metrics_user_idx on public.gos_content_metrics (user_id, metric_date desc);
create index gos_content_metrics_theme_idx on public.gos_content_metrics (theme_tag);

-- ============================================================
-- 8. gos_calendar_items: Threads/note/商品発売の横断予定
-- ============================================================
create table public.gos_calendar_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  item_type text not null check (item_type in ('THREADS', 'NOTE_FREE', 'NOTE_PAID', 'PRODUCT_LAUNCH')),
  ref_id uuid not null,
  scheduled_date date not null,
  scheduled_time time,
  status text not null default 'PLANNED' check (status in ('PLANNED', 'DONE', 'SKIPPED')),
  -- 将来のドラッグ&ドロップ並び替えに備えた列。V1では未使用。
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_calendar_items_user_date_idx on public.gos_calendar_items (user_id, scheduled_date);

create trigger gos_calendar_items_set_updated_at
  before update on public.gos_calendar_items
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 9. gos_ai_jobs: Agent実行のジョブキュー(非同期・リトライ管理)
-- ============================================================
create table public.gos_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  job_type text not null check (job_type in (
    'RESEARCH_CLASSIFY', 'IDEA_SCORE', 'THREADS_GENERATE', 'THREADS_TONE_ANALYZE',
    'ARTICLE_ADVANCE', 'PRODUCT_SUGGEST', 'ANALYTICS_ADVISE'
  )),
  target_type text not null check (target_type in (
    'RESEARCH_ITEM', 'IDEA', 'THREADS_POST', 'NOTE_ARTICLE', 'PRODUCT_SOURCE', 'ANALYTICS'
  )),
  target_id uuid not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_ai_jobs_status_idx on public.gos_ai_jobs (status, created_at);
create index gos_ai_jobs_user_idx on public.gos_ai_jobs (user_id);

create trigger gos_ai_jobs_set_updated_at
  before update on public.gos_ai_jobs
  for each row execute function public.gos_set_updated_at();

-- ジョブキューからの排他的な取り出し。Route Handler(cron)がService Role経由で呼び出す。
-- security definerだが、テーブル所有者はデフォルトでRLSの対象外になるため、
-- RLSを迂回してキュー全体(全ユーザー分)を横断的に処理できる。
create or replace function public.gos_dequeue_next_job()
returns public.gos_ai_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  next_job public.gos_ai_jobs;
begin
  select * into next_job
  from public.gos_ai_jobs
  where status = 'PENDING'
  order by created_at
  limit 1
  for update skip locked;

  if next_job.id is null then
    return null;
  end if;

  update public.gos_ai_jobs
  set status = 'RUNNING', attempt_count = attempt_count + 1
  where id = next_job.id
  returning * into next_job;

  return next_job;
end;
$$;

-- ============================================================
-- 10. gos_settings: スコア重み・プロンプト・予算上限などのKVストア
-- ============================================================
create table public.gos_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create trigger gos_settings_set_updated_at
  before update on public.gos_settings
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- RLS: 全テーブルで本人の行のみアクセス可能にする(既存パターンを踏襲)
-- ============================================================
alter table public.gos_research_items enable row level security;
alter table public.gos_content_ideas enable row level security;
alter table public.gos_threads_posts enable row level security;
alter table public.gos_note_articles enable row level security;
alter table public.gos_ai_reviews enable row level security;
alter table public.gos_products enable row level security;
alter table public.gos_content_metrics enable row level security;
alter table public.gos_calendar_items enable row level security;
alter table public.gos_ai_jobs enable row level security;
alter table public.gos_settings enable row level security;

create policy "gos_research_items_all_own" on public.gos_research_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_content_ideas_all_own" on public.gos_content_ideas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_threads_posts_all_own" on public.gos_threads_posts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_note_articles_all_own" on public.gos_note_articles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ai_reviews はAIの判断根拠の監査証跡のため、参照・追加のみ許可し更新・削除は禁止する。
create policy "gos_ai_reviews_select_own" on public.gos_ai_reviews
  for select using (auth.uid() = user_id);

create policy "gos_ai_reviews_insert_own" on public.gos_ai_reviews
  for insert with check (auth.uid() = user_id);

create policy "gos_products_all_own" on public.gos_products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_content_metrics_all_own" on public.gos_content_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_calendar_items_all_own" on public.gos_calendar_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_ai_jobs_all_own" on public.gos_ai_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_settings_all_own" on public.gos_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
