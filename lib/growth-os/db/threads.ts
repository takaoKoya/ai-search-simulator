import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ThreadsPatternType,
  ThreadsPost,
  ThreadsPostStatus,
  ThreadsScoreReasonEntry,
  ThreadsToneScores,
} from "@/lib/growth-os/types";

export async function listThreadsPosts(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ThreadsPost[];
}

export async function listThreadsPostsByIdea(supabase: SupabaseClient, userId: string, ideaId: string) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .select("*")
    .eq("user_id", userId)
    .eq("idea_id", ideaId)
    .order("pattern_type", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ThreadsPost[];
}

export async function getThreadsPost(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ThreadsPost | null;
}

export async function createThreadsPost(
  supabase: SupabaseClient,
  userId: string,
  ideaId: string,
  patternType: ThreadsPatternType,
  body: string
) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .insert({ user_id: userId, idea_id: ideaId, pattern_type: patternType, body })
    .select("*")
    .single();

  if (error) throw error;
  return data as ThreadsPost;
}

export interface CreateThreadsPostFullInput {
  idea_id: string;
  strategy_id: string | null;
  pattern_type: ThreadsPatternType;
  body: string;
  experience_ids: string[];
}

/** フェーズ3のThreads Content Engine経由の生成。strategy_id/experience_idsまで一度に保存する。 */
export async function createThreadsPostFull(supabase: SupabaseClient, userId: string, input: CreateThreadsPostFullInput) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as ThreadsPost;
}

/** @deprecated フェーズ3の9軸評価(applyThreadsScore)に置き換え。 */
export async function updateThreadsToneScores(supabase: SupabaseClient, id: string, tone_scores: ThreadsToneScores) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .update({ tone_scores, status: "WAITING_APPROVAL" })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ThreadsPost;
}

export interface ThreadsScorePatch {
  hook_score: number;
  empathy_score: number;
  humanity_score: number;
  clarity_score: number;
  shareability_score: number;
  sales_smell_score: number;
  ai_smell_score: number;
  preachiness_score: number;
  fear_score: number;
  overall_score: number;
  score_reason: ThreadsScoreReasonEntry[];
}

/** 9軸品質評価(セクション4)を保存する。品質基準を満たせばWAITING_APPROVALへ進める。 */
export async function applyThreadsScore(
  supabase: SupabaseClient,
  id: string,
  patch: ThreadsScorePatch,
  meetsQualityBar: boolean
) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .update({ ...patch, status: meetsQualityBar ? "WAITING_APPROVAL" : "DRAFT" })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ThreadsPost;
}

/** リライト結果を保存し、rewrite_countを+1する(DB制約により最大2回まで)。manual_edited済みは呼び出し側で除外すること。 */
export async function applyThreadsRewrite(
  supabase: SupabaseClient,
  post: Pick<ThreadsPost, "id" | "rewrite_count">,
  body: string,
  experienceIds: string[]
) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .update({ body, experience_ids: experienceIds, rewrite_count: post.rewrite_count + 1 })
    .eq("id", post.id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ThreadsPost;
}

/** 人間による手動編集。以降このPostはAI再生成(リライト)の対象から外れる(manual_edited=true)。 */
export async function applyManualThreadsEdit(supabase: SupabaseClient, id: string, body: string) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .update({ body, manual_edited: true })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ThreadsPost;
}

export async function updateThreadsPostStatus(supabase: SupabaseClient, id: string, status: ThreadsPostStatus) {
  const patch: Record<string, unknown> = { status };
  if (status === "PUBLISHED") patch.published_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("gos_threads_posts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ThreadsPost;
}
