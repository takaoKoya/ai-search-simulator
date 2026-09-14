import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentIdea, IdeaScoreBreakdownEntry, IdeaStatus } from "@/lib/growth-os/types";

export interface CreateIdeaInput {
  research_item_id?: string | null;
  title: string;
  summary?: string | null;
}

export async function listIdeas(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .select("*")
    .eq("user_id", userId)
    .order("total_score", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ContentIdea[];
}

export async function getIdeasByIds(supabase: SupabaseClient, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("gos_content_ideas").select("*").eq("user_id", userId).in("id", ids);
  if (error) throw error;
  return (data ?? []) as ContentIdea[];
}

export async function getIdea(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ContentIdea | null;
}

/** ダッシュボードの「今日作るべきコンテンツ」候補。
 * 優先順位: ①未着手(NEW)のTOPスコアIdeaを最優先 ②なければ次点のスコア順。 */
export async function getTodaysTopIdea(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "NEW")
    .order("total_score", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as ContentIdea | null;
}

export async function createIdea(supabase: SupabaseClient, userId: string, input: CreateIdeaInput) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentIdea;
}

export async function updateIdeaScore(
  supabase: SupabaseClient,
  id: string,
  score_breakdown: IdeaScoreBreakdownEntry[],
  total_score: number
) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .update({ score_breakdown, total_score })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentIdea;
}

export async function updateIdeaStatus(supabase: SupabaseClient, id: string, status: IdeaStatus) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentIdea;
}
