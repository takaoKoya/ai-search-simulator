-- note Growth OS フェーズ3: 「承認済みIdeaを販売可能品質のコンテンツへ変換する」スタジオ機能。
-- 既存の gos_research_items / gos_content_ideas / gos_threads_posts / gos_note_articles /
-- gos_ai_reviews / gos_ai_jobs / gos_products / gos_settings は破壊せず拡張する。
-- gos_content_metrics / gos_calendar_items はフェーズ3では変更しない。

-- ============================================================
-- 1. gos_content_strategies: 「何を書くか」の前に「読者をどう動かすか」を定義する
-- ============================================================
create table public.gos_content_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  idea_id uuid not null unique references public.gos_content_ideas (id) on delete cascade,
  target_reader text not null,
  reader_situation text not null,
  surface_problem text not null,
  deep_problem text not null,
  desired_emotion text not null,
  desired_action text not null,
  main_message text not null,
  unique_angle text not null,
  content_goal text not null,
  free_or_paid text not null check (free_or_paid in ('FREE', 'PAID', 'BOTH')),
  cta_strategy text not null,
  threads_role text not null,
  free_note_role text not null,
  paid_note_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger gos_content_strategies_set_updated_at
  before update on public.gos_content_strategies
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 2. gos_experience_library: 架空体験防止のための本人実体験ストック
-- ============================================================
create table public.gos_experience_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  summary text not null,
  tags text[] not null default '{}',
  confidence text not null default 'UNVERIFIED' check (confidence in ('VERIFIED_BY_USER', 'UNVERIFIED', 'NEEDS_REVIEW')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_experience_library_user_idx on public.gos_experience_library (user_id);

create trigger gos_experience_library_set_updated_at
  before update on public.gos_experience_library
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 3. gos_writing_profiles / gos_writing_samples: Voice / Writing Style Engine
-- ============================================================
create table public.gos_writing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  preferred_tone text not null default '',
  sentence_length text not null default 'MEDIUM' check (sentence_length in ('SHORT', 'MEDIUM', 'LONG')),
  humor_level integer not null default 20 check (humor_level between 0 and 100),
  directness integer not null default 60 check (directness between 0 and 100),
  emotional_level integer not null default 60 check (emotional_level between 0 and 100),
  technical_level integer not null default 30 check (technical_level between 0 and 100),
  emoji_level integer not null default 0 check (emoji_level between 0 and 100),
  line_break_style text not null default 'MODERATE' check (line_break_style in ('FREQUENT', 'MODERATE', 'MINIMAL')),
  ng_phrases text[] not null default '{}',
  preferred_phrases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger gos_writing_profiles_set_updated_at
  before update on public.gos_writing_profiles
  for each row execute function public.gos_set_updated_at();

create table public.gos_writing_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source_type text not null check (source_type in ('THREADS_POST', 'NOTE_ARTICLE')),
  source_id uuid not null,
  excerpt text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index gos_writing_samples_user_idx on public.gos_writing_samples (user_id);

-- ============================================================
-- 4. gos_article_sections: Section単位でDraft/Fact Check/編集を可能にする
-- ============================================================
create table public.gos_article_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  article_id uuid not null references public.gos_note_articles (id) on delete cascade,
  heading text not null,
  purpose text,
  key_points jsonb not null default '[]'::jsonb,
  evidence_required boolean not null default false,
  experience_required boolean not null default false,
  content text not null default '',
  source_ids uuid[] not null default '{}',
  experience_ids uuid[] not null default '{}',
  sort_order integer not null default 0,
  manual_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gos_article_sections_article_idx on public.gos_article_sections (article_id, sort_order);

create trigger gos_article_sections_set_updated_at
  before update on public.gos_article_sections
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 5. gos_article_versions: AIによる上書きから手動編集を守るための版管理
-- (note本文・Threads本文の両方に対応できるようtarget_type/target_idで汎用化)
-- ============================================================
create table public.gos_article_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  target_type text not null check (target_type in ('NOTE_ARTICLE', 'THREADS_POST')),
  target_id uuid not null,
  version integer not null,
  content text not null,
  created_by text not null check (created_by in ('AI', 'USER')),
  reason text,
  created_at timestamptz not null default now(),
  unique (target_type, target_id, version)
);

create index gos_article_versions_target_idx on public.gos_article_versions (target_type, target_id, version desc);

-- ============================================================
-- 6. gos_fact_claims: Fact Checkを独立工程として扱う
-- ============================================================
create table public.gos_fact_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  article_id uuid not null references public.gos_note_articles (id) on delete cascade,
  section_id uuid references public.gos_article_sections (id) on delete set null,
  claim text not null,
  classification text not null check (classification in ('VERIFIED', 'SUPPORTED', 'UNVERIFIED', 'OPINION', 'EXPERIENCE')),
  source_id uuid references public.gos_research_items (id) on delete set null,
  confidence numeric check (confidence is null or confidence between 0 and 100),
  action_required boolean not null default false,
  created_at timestamptz not null default now()
);

create index gos_fact_claims_article_idx on public.gos_fact_claims (article_id);

-- ============================================================
-- 7. gos_content_funnels: Idea起点のThreads→FreeNote→PaidNote→Product追跡
-- ============================================================
create table public.gos_content_funnels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  idea_id uuid not null unique references public.gos_content_ideas (id) on delete cascade,
  threads_post_ids uuid[] not null default '{}',
  free_note_id uuid references public.gos_note_articles (id) on delete set null,
  paid_note_id uuid references public.gos_note_articles (id) on delete set null,
  product_id uuid references public.gos_products (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger gos_content_funnels_set_updated_at
  before update on public.gos_content_funnels
  for each row execute function public.gos_set_updated_at();

-- ============================================================
-- 8. gos_note_articles: 統一Content Status + Outline/CTA/有料候補判定フィールド
-- ============================================================
-- 旧 current_stage(4段階の内部ステージ)は、statusそのものを工程の粒度まで
-- 細かくしたことで役目を終えたため削除する。
alter table public.gos_note_articles drop constraint gos_note_articles_current_stage_check;
alter table public.gos_note_articles drop column current_stage;

alter table public.gos_note_articles drop constraint gos_note_articles_status_check;
alter table public.gos_note_articles add constraint gos_note_articles_status_check check (
  status in (
    'IDEA', 'STRATEGY', 'OUTLINE', 'DRAFT', 'AI_REVIEW', 'FACT_CHECK',
    'WAITING_APPROVAL', 'APPROVED', 'PUBLISHED', 'ANALYZED', 'REJECTED'
  )
);

alter table public.gos_note_articles
  add column strategy_id uuid references public.gos_content_strategies (id) on delete set null,
  add column title_candidates jsonb not null default '[]'::jsonb,
  add column lead text,
  add column reader_problem text,
  add column promise text,
  add column cta_type text check (cta_type is null or cta_type in (
    'FOLLOW', 'NEXT_ARTICLE', 'FREE_DIAGNOSIS', 'PAID_NOTE', 'PRODUCT', 'COMMENT'
  )),
  add column cta_text text,
  add column outline_approved_at timestamptz,
  add column is_paid_candidate boolean not null default false,
  add column paid_candidate_evaluation jsonb;

-- ============================================================
-- 9. gos_threads_posts: 9軸品質評価 + リライト上限 + 手動編集保護 + Experience紐付け
-- ============================================================
alter table public.gos_threads_posts
  add column strategy_id uuid references public.gos_content_strategies (id) on delete set null,
  add column hook_score numeric check (hook_score is null or hook_score between 0 and 100),
  add column empathy_score numeric check (empathy_score is null or empathy_score between 0 and 100),
  add column humanity_score numeric check (humanity_score is null or humanity_score between 0 and 100),
  add column clarity_score numeric check (clarity_score is null or clarity_score between 0 and 100),
  add column shareability_score numeric check (shareability_score is null or shareability_score between 0 and 100),
  add column sales_smell_score numeric check (sales_smell_score is null or sales_smell_score between 0 and 100),
  add column ai_smell_score numeric check (ai_smell_score is null or ai_smell_score between 0 and 100),
  add column preachiness_score numeric check (preachiness_score is null or preachiness_score between 0 and 100),
  add column fear_score numeric check (fear_score is null or fear_score between 0 and 100),
  add column overall_score numeric check (overall_score is null or overall_score between 0 and 100),
  add column score_reason jsonb not null default '{}'::jsonb,
  -- 品質基準未達の自動リライトは最大2回まで(無限ループ禁止)。DBレベルでも強制する。
  add column rewrite_count integer not null default 0 check (rewrite_count between 0 and 2),
  -- ユーザーが手動編集した本文はAI再生成で絶対に上書きしない。
  add column manual_edited boolean not null default false,
  add column experience_ids uuid[] not null default '{}';

-- ============================================================
-- 10. gos_ai_reviews / gos_ai_jobs: フェーズ3のAgent・ジョブ種別を追加
-- ============================================================
alter table public.gos_ai_reviews drop constraint gos_ai_reviews_agent_type_check;
alter table public.gos_ai_reviews add constraint gos_ai_reviews_agent_type_check check (
  agent_type in (
    'RESEARCH_CLASSIFIER', 'IDEA_GENERATOR', 'IDEA_SCORER', 'THREADS_GENERATOR', 'THREADS_TONE_ANALYZER',
    'RESEARCH_AGENT', 'PLANNING_AGENT', 'WRITER_AGENT', 'READER_50S_AGENT',
    'CHIEF_EDITOR_AGENT', 'FACT_CHECK_AGENT', 'SALES_EDITOR_AGENT',
    'PRODUCT_SUGGESTER', 'ANALYTICS_ADVISOR',
    'STRATEGY_EDITOR', 'OUTLINE_GENERATOR', 'TITLE_GENERATOR', 'SECTION_WRITER',
    'FACT_CLAIM_EXTRACTOR', 'HUMANITY_CHECKER', 'PAID_CANDIDATE_EVALUATOR', 'AI_SMELL_DETECTOR'
  )
);

alter table public.gos_ai_jobs drop constraint gos_ai_jobs_job_type_check;
alter table public.gos_ai_jobs add constraint gos_ai_jobs_job_type_check check (
  job_type in (
    'RESEARCH_CLASSIFY', 'IDEA_GENERATE', 'IDEA_SCORE', 'THREADS_GENERATE', 'THREADS_TONE_ANALYZE',
    'THREADS_REWRITE', 'ARTICLE_ADVANCE', 'PAID_CANDIDATE_EVALUATE', 'PRODUCT_SUGGEST', 'ANALYTICS_ADVISE'
  )
);

-- ============================================================
-- RLS: 新規テーブルすべてに既存パターン(本人の行のみ)を適用
-- ============================================================
alter table public.gos_content_strategies enable row level security;
alter table public.gos_experience_library enable row level security;
alter table public.gos_writing_profiles enable row level security;
alter table public.gos_writing_samples enable row level security;
alter table public.gos_article_sections enable row level security;
alter table public.gos_article_versions enable row level security;
alter table public.gos_fact_claims enable row level security;
alter table public.gos_content_funnels enable row level security;

create policy "gos_content_strategies_all_own" on public.gos_content_strategies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_experience_library_all_own" on public.gos_experience_library
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_writing_profiles_all_own" on public.gos_writing_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_writing_samples_all_own" on public.gos_writing_samples
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "gos_article_sections_all_own" on public.gos_article_sections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- article_versionsは監査証跡として参照・追加のみ許可し、更新・削除は禁止する。
create policy "gos_article_versions_select_own" on public.gos_article_versions
  for select using (auth.uid() = user_id);

create policy "gos_article_versions_insert_own" on public.gos_article_versions
  for insert with check (auth.uid() = user_id);

create policy "gos_fact_claims_select_own" on public.gos_fact_claims
  for select using (auth.uid() = user_id);

create policy "gos_fact_claims_insert_own" on public.gos_fact_claims
  for insert with check (auth.uid() = user_id);

create policy "gos_content_funnels_all_own" on public.gos_content_funnels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
