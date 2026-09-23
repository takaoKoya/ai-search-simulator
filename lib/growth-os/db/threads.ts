import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThreadsPatternType, ThreadsPost, ThreadsPostStatus, ThreadsToneScores } from "@/lib/growth-os/types";

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

export async function updateThreadsToneScores(
  supabase: SupabaseClient,
  id: string,
  tone_scores: ThreadsToneScores
) {
  const { data, error } = await supabase
    .from("gos_threads_posts")
    .update({ tone_scores, status: "WAITING_APPROVAL" })
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
