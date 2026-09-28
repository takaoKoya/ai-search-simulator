import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentStrategy } from "@/lib/growth-os/types";
import type { ContentStrategyDraft } from "@/lib/growth-os/ai/schemas";

export async function getContentStrategyByIdea(supabase: SupabaseClient, userId: string, ideaId: string) {
  const { data, error } = await supabase
    .from("gos_content_strategies")
    .select("*")
    .eq("user_id", userId)
    .eq("idea_id", ideaId)
    .maybeSingle();

  if (error) throw error;
  return data as ContentStrategy | null;
}

export async function getContentStrategy(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_content_strategies")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ContentStrategy | null;
}

export async function createContentStrategy(
  supabase: SupabaseClient,
  userId: string,
  ideaId: string,
  draft: ContentStrategyDraft
) {
  const { data, error } = await supabase
    .from("gos_content_strategies")
    .insert({ ...draft, user_id: userId, idea_id: ideaId })
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentStrategy;
}
