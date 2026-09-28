-- note Growth OS フェーズ2: 「収益テーマ発掘エンジン」への再設計
-- 対象: gos_research_items / gos_content_ideas / gos_ai_jobs / gos_ai_reviews の拡張、
-- gos_idea_sources(Evidence用の中間テーブル)の新規追加。
-- gos_threads_posts / gos_note_articles / gos_products / gos_content_metrics / gos_calendar_items /
-- gos_settings はフェーズ2では変更しない。
-- 本番へはまだ一切のマイグレーションが適用されていないため、破壊的なrename/drop/型変更を
-- 素朴に行っても実データへの影響はない(現時点でのバックフィル対象データは存在しない)。

-- ============================================================
-- 1. gos_research_items: フィールド拡張
-- ============================================================

-- 出典の「種別」と「名称」を分離する(例: source_type='SNS', source_name='X(旧Twitter)')
alter table public.gos_research_items rename column source to source_name;
alter table public.gos_research_items
  add column source_type text not null default 'MANUAL' check (
    source_type in ('URL', 'MANUAL', 'SNS', 'NEWS', 'SEARCH', 'OTHER')
  );

-- 要約(summary)とは別に、原文/メモ全文を保持する列
alter table public.gos_research_items add column raw_text text;

-- 自由記述の target_age を最小/最大の数値レンジへ置き換える
alter table public.gos_research_items drop column target_age;
alter table public.gos_research_items
  add column target_age_min integer check (target_age_min is null or target_age_min between 0 and 120),
  add column target_age_max integer check (target_age_max is null or target_age_max between 0 and 120),
  add constraint gos_research_items_age_range_check check (
    target_age_min is null or target_age_max is null or target_age_min <= target_age_max
  );

-- harm_type -> harm_types (他テーブルの命名/複数選択であることを明確化)
alter table public.gos_research_items rename column harm_type to harm_types;

-- AIによる悩み抽出(表面/深層/感情トリガー)
alter table public.gos_research_items
  add column surface_problem text,
  add column deep_problem text,
  add column emotional_trigger text;

-- 情報が「いつのものか」(収集日) と、DB行の作成日(created_at)を分離
alter table public.gos_research_items add column collected_at timestamptz not null default now();

-- 同一内容の再解析を避けるためのハッシュ/バージョン管理(セクション17: AIコスト管理)
alter table public.gos_research_items
  add column content_hash text,
  add column analysis_version integer not null default 0,
  add column last_analyzed_at timestamptz;

create index gos_research_items_source_type_idx on public.gos_research_items (user_id, source_type);
create index gos_research_items_collected_at_idx on public.gos_research_items (user_id, collected_at desc);

-- ============================================================
-- 2. gos_content_ideas: 9軸を実カラム化 + Confidence/重複検出/Evidence
-- ============================================================

-- score_breakdown(JSONB配列)は「なぜその点数か」の保存という役割を維持しつつ、
-- 仕様の項目名に合わせて score_reason へ改名する。
alter table public.gos_content_ideas rename column score_breakdown to score_reason;

-- 旧: 生成列 tier は total_score(手動更新の単純numeric)に依存していた。
-- 新: total_score は9軸の合計を表す生成列にするため、まず依存する tier と
-- 旧 total_score を削除してから、9軸の実カラム + 新しい total_score を追加する。
alter table public.gos_content_ideas drop column tier;
alter table public.gos_content_ideas drop column total_score;

alter table public.gos_content_ideas
  add column hook text,
  add column angle text,
  add column target_persona text,
  add column core_problem text,
  add column harm_types text[] not null default '{}',
  -- 需要 15 / 悩みの深さ 15 / 支払意欲 15 / 競合余地 10 / トレンド性 10 /
  -- Threads拡散性 10 / note記事適性 10 / 有料商品接続性 10 / ユーザー適性 5 = 100点
  add column demand_score numeric check (demand_score is null or demand_score between 0 and 15),
  add column pain_score numeric check (pain_score is null or pain_score between 0 and 15),
  add column willingness_to_pay_score numeric check (willingness_to_pay_score is null or willingness_to_pay_score between 0 and 15),
  add column competition_opportunity_score numeric check (competition_opportunity_score is null or competition_opportunity_score between 0 and 10),
  add column trend_score numeric check (trend_score is null or trend_score between 0 and 10),
  add column threads_virality_score numeric check (threads_virality_score is null or threads_virality_score between 0 and 10),
  add column note_fit_score numeric check (note_fit_score is null or note_fit_score between 0 and 10),
  add column product_connection_score numeric check (product_connection_score is null or product_connection_score between 0 and 10),
  add column user_fit_score numeric check (user_fit_score is null or user_fit_score between 0 and 5),
  add column total_score numeric generated always as (
    coalesce(demand_score, 0) + coalesce(pain_score, 0) + coalesce(willingness_to_pay_score, 0) +
    coalesce(competition_opportunity_score, 0) + coalesce(trend_score, 0) + coalesce(threads_virality_score, 0) +
    coalesce(note_fit_score, 0) + coalesce(product_connection_score, 0) + coalesce(user_fit_score, 0)
  ) stored,
  add column recommended_format text check (recommended_format is null or recommended_format in ('THREADS', 'NOTE_FREE', 'NOTE_PAID', 'BOTH')),
  add column recommended_free_or_paid text check (recommended_free_or_paid is null or recommended_free_or_paid in ('FREE', 'PAID', 'EITHER')),
  -- AIの自己申告点数を鵜呑みにしないための、根拠の強さを表す指標群(セクション4)
  add column confidence_score numeric check (confidence_score is null or confidence_score between 0 and 100),
  add column evidence_count integer not null default 0 check (evidence_count >= 0),
  add column source_count integer not null default 0 check (source_count >= 0),
  add column freshness_score numeric check (freshness_score is null or freshness_score between 0 and 100),
  -- 重複テーマ検出(セクション12)。将来Embeddingベースの類似度に差し替え可能なよう、
  -- スコアと「最も似ているIdea」への参照のみを保持し、判定ロジック自体はアプリ層(lib/growth-os/dedupe.ts)に置く。
  add column duplicate_score numeric check (duplicate_score is null or duplicate_score between 0 and 1),
  add column most_similar_idea_id uuid references public.gos_content_ideas (id) on delete set null;

alter table public.gos_content_ideas drop constraint gos_content_ideas_status_check;
alter table public.gos_content_ideas add constraint gos_content_ideas_status_check check (
  status in ('NEW', 'PRIORITY', 'CANDIDATE', 'HOLD', 'APPROVED', 'REJECTED')
);

create index gos_content_ideas_user_score_idx on public.gos_content_ideas (user_id, total_score desc);
create index gos_content_ideas_status_idx on public.gos_content_ideas (user_id, status);

-- ============================================================
-- 3. gos_idea_sources: Ideaの根拠となったResearchとの中間テーブル(Evidence)
-- ============================================================
-- 1つのIdeaが複数のResearchを根拠にできる(逆に1つのResearchから複数Ideaが生まれることもある)ため、
-- content_ideas.research_item_id(単一・任意の「主たる出典」)とは別に多対多の対応表を持つ。
-- 過剰なテーブル分割を避けるため、Evidence関連で新設するテーブルはこの1つのみに絞る。
create table public.gos_idea_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  idea_id uuid not null references public.gos_content_ideas (id) on delete cascade,
  research_item_id uuid not null references public.gos_research_items (id) on delete cascade,
  evidence text,
  created_at timestamptz not null default now(),
  unique (idea_id, research_item_id)
);

create index gos_idea_sources_idea_idx on public.gos_idea_sources (idea_id);
create index gos_idea_sources_research_idx on public.gos_idea_sources (research_item_id);

alter table public.gos_idea_sources enable row level security;

create policy "gos_idea_sources_all_own" on public.gos_idea_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 4. gos_ai_reviews: Idea生成Agentを追加
-- ============================================================
alter table public.gos_ai_reviews drop constraint gos_ai_reviews_agent_type_check;
alter table public.gos_ai_reviews add constraint gos_ai_reviews_agent_type_check check (
  agent_type in (
    'RESEARCH_CLASSIFIER', 'IDEA_GENERATOR', 'IDEA_SCORER', 'THREADS_GENERATOR', 'THREADS_TONE_ANALYZER',
    'RESEARCH_AGENT', 'PLANNING_AGENT', 'WRITER_AGENT', 'READER_50S_AGENT',
    'CHIEF_EDITOR_AGENT', 'FACT_CHECK_AGENT', 'SALES_EDITOR_AGENT',
    'PRODUCT_SUGGESTER', 'ANALYTICS_ADVISOR'
  )
);

-- ============================================================
-- 5. gos_ai_jobs: コスト計測列 + Idea生成ジョブ種別
-- ============================================================
alter table public.gos_ai_jobs drop constraint gos_ai_jobs_job_type_check;
alter table public.gos_ai_jobs add constraint gos_ai_jobs_job_type_check check (
  job_type in (
    'RESEARCH_CLASSIFY', 'IDEA_GENERATE', 'IDEA_SCORE', 'THREADS_GENERATE', 'THREADS_TONE_ANALYZE',
    'ARTICLE_ADVANCE', 'PRODUCT_SUGGEST', 'ANALYTICS_ADVISE'
  )
);

alter table public.gos_ai_jobs drop constraint gos_ai_jobs_target_type_check;
alter table public.gos_ai_jobs add constraint gos_ai_jobs_target_type_check check (
  target_type in ('RESEARCH_ITEM', 'RESEARCH_ITEM_SET', 'IDEA', 'THREADS_POST', 'NOTE_ARTICLE', 'PRODUCT_SOURCE', 'ANALYTICS')
);

alter table public.gos_ai_jobs rename column error to error_message;

alter table public.gos_ai_jobs
  add column model text,
  add column input_tokens integer not null default 0 check (input_tokens >= 0),
  add column output_tokens integer not null default 0 check (output_tokens >= 0),
  -- USD想定。Claude課金はUSD建てのため、円換算はアプリ層/表示側で行う。
  add column estimated_cost numeric not null default 0 check (estimated_cost >= 0),
  add column started_at timestamptz,
  add column completed_at timestamptz;

-- dequeue時にstarted_atを記録するよう更新する(初回取り出し時刻のみ記録し、リトライでは上書きしない)。
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
  set status = 'RUNNING', attempt_count = attempt_count + 1, started_at = coalesce(started_at, now())
  where id = next_job.id
  returning * into next_job;

  return next_job;
end;
$$;
