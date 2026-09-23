// note Growth OS のドメイン型。
// supabase/migrations/20260914000000_growth_os_schema.sql +
// supabase/migrations/20260921000000_growth_os_theme_engine.sql と対応させること。

export type HarmType = "Health" | "Ambition" | "Relation" | "Money";

export const HARM_TYPES: HarmType[] = ["Health", "Ambition", "Relation", "Money"];

export const HARM_TYPE_LABELS: Record<HarmType, string> = {
  Health: "Health(健康)",
  Ambition: "Ambition(自己実現・向上心)",
  Relation: "Relation(人間関係)",
  Money: "Money(お金)",
};

export type ResearchStatus = "NEW" | "REVIEWED" | "PROMOTED" | "ARCHIVED";
export type ResearchSourceType = "URL" | "MANUAL" | "SNS" | "NEWS" | "SEARCH" | "OTHER";

export const RESEARCH_SOURCE_TYPE_LABELS: Record<ResearchSourceType, string> = {
  URL: "URL",
  MANUAL: "手動メモ",
  SNS: "SNS",
  NEWS: "ニュース",
  SEARCH: "検索結果",
  OTHER: "その他",
};

export interface ResearchItem {
  id: string;
  user_id: string;
  source_type: ResearchSourceType;
  source_name: string;
  source_url: string | null;
  keyword: string | null;
  title: string;
  summary: string | null;
  raw_text: string | null;
  target_age_min: number | null;
  target_age_max: number | null;
  harm_types: HarmType[];
  // AIによる悩み抽出(セクション5): 表面的な悩み/その裏にある本質的な恐怖/引き金になっている出来事
  surface_problem: string | null;
  deep_problem: string | null;
  emotional_trigger: string | null;
  trend_score: number | null; // 0-100
  pain_score: number | null; // 0-100 (市場全体で見た悩みの深刻さ。content_ideas.pain_score とは尺度が異なる)
  status: ResearchStatus;
  collected_at: string;
  content_hash: string | null;
  analysis_version: number;
  last_analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeaSource {
  id: string;
  user_id: string;
  idea_id: string;
  research_item_id: string;
  evidence: string | null;
  created_at: string;
}

// 需要15 / 悩みの深さ15 / 支払意欲15 / 競合余地10 / トレンド性10 /
// Threads拡散性10 / note記事適性10 / 有料商品接続性10 / ユーザー適性5 = 100点
export const IDEA_SCORE_CRITERIA = [
  { key: "demand", column: "demand_score", label: "需要", weight: 15 },
  { key: "pain", column: "pain_score", label: "悩みの深さ", weight: 15 },
  { key: "willingness_to_pay", column: "willingness_to_pay_score", label: "支払意欲", weight: 15 },
  { key: "competition_opportunity", column: "competition_opportunity_score", label: "競合余地", weight: 10 },
  { key: "trend", column: "trend_score", label: "トレンド性", weight: 10 },
  { key: "threads_virality", column: "threads_virality_score", label: "Threads拡散性", weight: 10 },
  { key: "note_fit", column: "note_fit_score", label: "note記事適性", weight: 10 },
  { key: "product_connection", column: "product_connection_score", label: "有料商品接続性", weight: 10 },
  { key: "user_fit", column: "user_fit_score", label: "ユーザー適性", weight: 5 },
] as const;

export type IdeaScoreCriterionKey = (typeof IDEA_SCORE_CRITERIA)[number]["key"];

/** score/reason/evidence を必ず組で保存する(AIに点数だけ言わせない)。 */
export interface IdeaScoreReasonEntry {
  criterion: IdeaScoreCriterionKey;
  score: number; // 0-weight
  reason: string;
  evidence: string;
}

/** total_scoreの帯によるラベル(DBのstatusとは独立した、UI表示専用の区分)。 */
export type ScoreBandCode = "TOP" | "CANDIDATE" | "HOLD" | "LOW";

export type IdeaStatus = "NEW" | "PRIORITY" | "CANDIDATE" | "HOLD" | "APPROVED" | "REJECTED";

export type RecommendedFormat = "THREADS" | "NOTE_FREE" | "NOTE_PAID" | "BOTH";
export type RecommendedFreeOrPaid = "FREE" | "PAID" | "EITHER";

export const RECOMMENDED_FORMAT_LABELS: Record<RecommendedFormat, string> = {
  THREADS: "Threads",
  NOTE_FREE: "無料note",
  NOTE_PAID: "有料note",
  BOTH: "Threads + note",
};

export interface ContentIdea {
  id: string;
  user_id: string;
  research_item_id: string | null;
  title: string;
  summary: string | null;
  hook: string | null;
  angle: string | null;
  target_persona: string | null;
  core_problem: string | null;
  harm_types: HarmType[];
  demand_score: number | null;
  pain_score: number | null;
  willingness_to_pay_score: number | null;
  competition_opportunity_score: number | null;
  trend_score: number | null;
  threads_virality_score: number | null;
  note_fit_score: number | null;
  product_connection_score: number | null;
  user_fit_score: number | null;
  total_score: number;
  score_reason: IdeaScoreReasonEntry[];
  recommended_format: RecommendedFormat | null;
  recommended_free_or_paid: RecommendedFreeOrPaid | null;
  status: IdeaStatus;
  // AIの点数を鵜呑みにしないための指標群(セクション4)
  confidence_score: number | null; // 0-100、根拠の強さから算出する「確定」信頼度
  evidence_count: number;
  source_count: number;
  freshness_score: number | null; // 0-100
  duplicate_score: number | null; // 0-1
  most_similar_idea_id: string | null;
  created_at: string;
  updated_at: string;
}

/** ContentIdea の9軸スコアを {key, score} の配列として取り出す小ヘルパー。 */
export function ideaScoreByCriterion(idea: ContentIdea): Record<IdeaScoreCriterionKey, number | null> {
  return {
    demand: idea.demand_score,
    pain: idea.pain_score,
    willingness_to_pay: idea.willingness_to_pay_score,
    competition_opportunity: idea.competition_opportunity_score,
    trend: idea.trend_score,
    threads_virality: idea.threads_virality_score,
    note_fit: idea.note_fit_score,
    product_connection: idea.product_connection_score,
    user_fit: idea.user_fit_score,
  };
}

export type ThreadsPatternType = "EMPATHY" | "PROBLEM" | "FAILURE" | "QUESTION" | "CONTRARIAN";

export const THREADS_PATTERN_LABELS: Record<ThreadsPatternType, string> = {
  EMPATHY: "共感型",
  PROBLEM: "問題提起型",
  FAILURE: "失敗談型",
  QUESTION: "問いかけ型",
  CONTRARIAN: "逆張り型",
};

export interface ThreadsToneScores {
  ai_smell: number;
  sales_smell: number;
  preachy: number;
  hype: number;
  humanity: number;
  empathy: number;
}

export type ThreadsPostStatus = "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "PUBLISHED" | "REJECTED";

export interface ThreadsPost {
  id: string;
  user_id: string;
  idea_id: string;
  pattern_type: ThreadsPatternType;
  body: string;
  tone_scores: ThreadsToneScores | null;
  status: ThreadsPostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
}

export type NoteArticleType = "FREE" | "PAID";

export type NoteArticleStage =
  | "RESEARCH"
  | "PLANNING"
  | "WRITING"
  | "READER_REVIEW"
  | "CHIEF_EDIT"
  | "FACT_CHECK"
  | "SALES_EDIT"
  | "DONE";

export const NOTE_ARTICLE_STAGE_ORDER: NoteArticleStage[] = [
  "RESEARCH",
  "PLANNING",
  "WRITING",
  "READER_REVIEW",
  "CHIEF_EDIT",
  "FACT_CHECK",
  "SALES_EDIT",
  "DONE",
];

export const NOTE_ARTICLE_STAGE_LABELS: Record<NoteArticleStage, string> = {
  RESEARCH: "Research Agent",
  PLANNING: "企画編集Agent",
  WRITING: "Writer Agent",
  READER_REVIEW: "50代読者Agent",
  CHIEF_EDIT: "辛口編集長Agent",
  FACT_CHECK: "Fact Check Agent",
  SALES_EDIT: "Sales Editor Agent",
  DONE: "完了",
};

export type NoteArticleStatus =
  | "IDEA"
  | "RESEARCHED"
  | "DRAFT"
  | "AI_REVIEWED"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "PUBLISHED"
  | "ANALYZED";

export interface NoteArticle {
  id: string;
  user_id: string;
  idea_id: string | null;
  type: NoteArticleType;
  price: number | null;
  title: string;
  body_markdown: string;
  current_stage: NoteArticleStage;
  revision_count: number;
  quality_score: number | null;
  quality_below_threshold: boolean;
  status: NoteArticleStatus;
  published_at: string | null;
  note_url: string | null;
  created_at: string;
  updated_at: string;
}

export type AiReviewTargetType = "RESEARCH_ITEM" | "IDEA" | "THREADS_POST" | "NOTE_ARTICLE";

export type AgentType =
  | "RESEARCH_CLASSIFIER"
  | "IDEA_GENERATOR"
  | "IDEA_SCORER"
  | "THREADS_GENERATOR"
  | "THREADS_TONE_ANALYZER"
  | "RESEARCH_AGENT"
  | "PLANNING_AGENT"
  | "WRITER_AGENT"
  | "READER_50S_AGENT"
  | "CHIEF_EDITOR_AGENT"
  | "FACT_CHECK_AGENT"
  | "SALES_EDITOR_AGENT"
  | "PRODUCT_SUGGESTER"
  | "ANALYTICS_ADVISOR";

export type AiReviewVerdict = "PASS" | "NEEDS_REVISION" | "FAIL";

export interface AiReview {
  id: string;
  user_id: string;
  target_type: AiReviewTargetType;
  target_id: string;
  agent_type: AgentType;
  revision_number: number;
  score: number | null;
  verdict: AiReviewVerdict | null;
  feedback: string | null;
  raw_response: unknown;
  created_at: string;
}

export type ProductStatus = "PROPOSED" | "IN_DEVELOPMENT" | "READY" | "LAUNCHED" | "ARCHIVED";

export interface Product {
  id: string;
  user_id: string;
  source_content_id: string | null;
  product_name: string;
  recommended_price: number | null;
  target: string | null;
  problem: string | null;
  solution: string | null;
  product_score: number | null;
  outline: unknown;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export type MetricContentType = "THREADS_POST" | "NOTE_ARTICLE" | "PRODUCT";

export interface ContentMetric {
  id: string;
  user_id: string;
  content_type: MetricContentType;
  content_id: string;
  metric_date: string;
  pv: number;
  likes: number;
  like_rate: number | null;
  follower_delta: number;
  sales_amount: number;
  purchase_count: number;
  theme_tag: string | null;
  created_at: string;
}

export type CalendarItemType = "THREADS" | "NOTE_FREE" | "NOTE_PAID" | "PRODUCT_LAUNCH";
export type CalendarItemStatus = "PLANNED" | "DONE" | "SKIPPED";

export interface CalendarItem {
  id: string;
  user_id: string;
  item_type: CalendarItemType;
  ref_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  status: CalendarItemStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type AiJobType =
  | "RESEARCH_CLASSIFY"
  | "IDEA_GENERATE"
  | "IDEA_SCORE"
  | "THREADS_GENERATE"
  | "THREADS_TONE_ANALYZE"
  | "ARTICLE_ADVANCE"
  | "PRODUCT_SUGGEST"
  | "ANALYTICS_ADVISE";

export type AiJobTargetType =
  | "RESEARCH_ITEM"
  | "RESEARCH_ITEM_SET"
  | "IDEA"
  | "THREADS_POST"
  | "NOTE_ARTICLE"
  | "PRODUCT_SOURCE"
  | "ANALYTICS";

export type AiJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface AiJob {
  id: string;
  user_id: string;
  job_type: AiJobType;
  target_type: AiJobTargetType;
  target_id: string;
  status: AiJobStatus;
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  result: unknown;
  error_message: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const THEME_TAGS = [
  "会社依存",
  "AI失業不安",
  "副業",
  "定年",
  "転職",
  "老後",
  "お金",
  "第二キャリア",
] as const;

export type ThemeTag = (typeof THEME_TAGS)[number];
