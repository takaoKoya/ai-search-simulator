// note Growth OS のドメイン型。supabase/migrations/20260914000000_growth_os_schema.sql と対応させること。

export type HarmType = "Health" | "Ambition" | "Relation" | "Money";

export type ResearchStatus = "NEW" | "REVIEWED" | "PROMOTED" | "ARCHIVED";

export interface ResearchItem {
  id: string;
  user_id: string;
  source: string;
  source_url: string | null;
  keyword: string | null;
  title: string;
  summary: string | null;
  target_age: string | null;
  harm_type: HarmType[];
  trend_score: number | null;
  pain_score: number | null;
  status: ResearchStatus;
  created_at: string;
  updated_at: string;
}

export const IDEA_SCORE_CRITERIA = [
  { key: "demand", label: "需要", weight: 15 },
  { key: "pain_depth", label: "悩みの深さ", weight: 15 },
  { key: "willingness_to_pay", label: "支払意欲", weight: 15 },
  { key: "competition_weakness", label: "競合の弱さ", weight: 10 },
  { key: "trend", label: "トレンド性", weight: 10 },
  { key: "threads_virality", label: "Threads拡散性", weight: 10 },
  { key: "note_fit", label: "note記事化適性", weight: 10 },
  { key: "product_connection", label: "有料商品接続性", weight: 10 },
  { key: "user_fit", label: "ユーザーとの相性", weight: 5 },
] as const;

export type IdeaScoreCriterionKey = (typeof IDEA_SCORE_CRITERIA)[number]["key"];

export interface IdeaScoreBreakdownEntry {
  criterion: IdeaScoreCriterionKey;
  weight: number;
  score: number; // 0-weight
  reasoning: string;
}

export type IdeaTier = "TOP" | "CANDIDATE" | "HOLD" | "REJECT";

export type IdeaStatus =
  | "NEW"
  | "APPROVED_FOR_THREADS"
  | "APPROVED_FOR_NOTE_FREE"
  | "APPROVED_FOR_NOTE_PAID"
  | "ON_HOLD"
  | "REJECTED";

export interface ContentIdea {
  id: string;
  user_id: string;
  research_item_id: string | null;
  title: string;
  summary: string | null;
  score_breakdown: IdeaScoreBreakdownEntry[];
  total_score: number;
  tier: IdeaTier;
  status: IdeaStatus;
  created_at: string;
  updated_at: string;
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
  | "IDEA_SCORE"
  | "THREADS_GENERATE"
  | "THREADS_TONE_ANALYZE"
  | "ARTICLE_ADVANCE"
  | "PRODUCT_SUGGEST"
  | "ANALYTICS_ADVISE";

export type AiJobTargetType =
  | "RESEARCH_ITEM"
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
  error: string | null;
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
