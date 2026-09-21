import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentIdea, HarmType, IdeaScoreReasonEntry, IdeaStatus, RecommendedFormat, RecommendedFreeOrPaid } from "@/lib/growth-os/types";

const ACTIONABLE_STATUSES: IdeaStatus[] = ["NEW", "PRIORITY", "CANDIDATE", "HOLD"];

export async function listIdeas(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .select("*")
    .eq("user_id", userId)
    .order("total_score", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ContentIdea[];
}

export async function listActionableIdeas(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .select("*")
    .eq("user_id", userId)
    .in("status", ACTIONABLE_STATUSES)
    .order("total_score", { ascending: false });

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

export async function getIdeasByIds(supabase: SupabaseClient, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("gos_content_ideas").select("*").eq("user_id", userId).in("id", ids);
  if (error) throw error;
  return (data ?? []) as ContentIdea[];
}

/** ダッシュボードの「今日、何をすべきか」候補。未決着(NEW/PRIORITY/CANDIDATE/HOLD)の中から最高得点を1件。
 * 未採点のIdea(total_score=0)は自然に下位になるため、まず採点済みの中から最良のものが選ばれる。 */
export async function getTodaysTopIdea(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .select("*")
    .eq("user_id", userId)
    .in("status", ACTIONABLE_STATUSES)
    .order("total_score", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as ContentIdea | null;
}

export async function listRecentlyApprovedIdeas(supabase: SupabaseClient, userId: string, limit = 20) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "APPROVED")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ContentIdea[];
}

export async function createIdeaManually(
  supabase: SupabaseClient,
  userId: string,
  input: { title: string; summary?: string | null }
) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentIdea;
}

export interface GeneratedIdeaInsert {
  title: string;
  hook: string;
  angle: string;
  target_persona: string;
  core_problem: string;
  harm_types: HarmType[];
  recommended_format: RecommendedFormat;
  recommended_free_or_paid: RecommendedFreeOrPaid;
}

export async function insertGeneratedIdeas(
  supabase: SupabaseClient,
  userId: string,
  ideas: GeneratedIdeaInsert[],
  primaryResearchItemId: string | null
) {
  const { data, error } = await supabase
    .from("gos_content_ideas")
    .insert(ideas.map((idea) => ({ ...idea, user_id: userId, research_item_id: primaryResearchItemId })))
    .select("*");

  if (error) throw error;
  return (data ?? []) as ContentIdea[];
}

export interface IdeaScoringPatch {
  demand_score: number;
  pain_score: number;
  willingness_to_pay_score: number;
  competition_opportunity_score: number;
  trend_score: number;
  threads_virality_score: number;
  note_fit_score: number;
  product_connection_score: number;
  user_fit_score: number;
  score_reason: IdeaScoreReasonEntry[];
  confidence_score: number;
  evidence_count: number;
  source_count: number;
  freshness_score: number;
  duplicate_score: number | null;
  most_similar_idea_id: string | null;
  status: IdeaStatus;
}

export async function applyIdeaScoring(supabase: SupabaseClient, id: string, patch: IdeaScoringPatch) {
  const { data, error } = await supabase.from("gos_content_ideas").update(patch).eq("id", id).select("*").single();
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
