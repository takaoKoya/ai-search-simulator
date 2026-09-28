import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdeaSource, ResearchItem } from "@/lib/growth-os/types";

export async function linkIdeaSources(
  supabase: SupabaseClient,
  userId: string,
  ideaId: string,
  sources: { research_item_id: string; evidence?: string | null }[]
) {
  if (sources.length === 0) return;
  const { error } = await supabase.from("gos_idea_sources").insert(
    sources.map((s) => ({
      user_id: userId,
      idea_id: ideaId,
      research_item_id: s.research_item_id,
      evidence: s.evidence ?? null,
    }))
  );
  if (error) throw error;
}

export async function listIdeaSources(supabase: SupabaseClient, userId: string, ideaId: string) {
  const { data, error } = await supabase
    .from("gos_idea_sources")
    .select("*")
    .eq("user_id", userId)
    .eq("idea_id", ideaId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as IdeaSource[];
}

/** Research詳細の「関連Idea」表示用: このResearchを根拠にしているIdeaのID一覧。 */
export async function listIdeaIdsForResearchItem(supabase: SupabaseClient, userId: string, researchItemId: string) {
  const { data, error } = await supabase
    .from("gos_idea_sources")
    .select("idea_id")
    .eq("user_id", userId)
    .eq("research_item_id", researchItemId);

  if (error) throw error;
  return (data ?? []).map((row) => row.idea_id as string);
}

/** Idea詳細のEvidenceセクション用: gos_idea_sources と gos_research_items をまとめて取得する。 */
export async function listIdeaEvidence(supabase: SupabaseClient, userId: string, ideaId: string) {
  const sources = await listIdeaSources(supabase, userId, ideaId);
  if (sources.length === 0) return [];

  const { data: researchItems, error } = await supabase
    .from("gos_research_items")
    .select("*")
    .eq("user_id", userId)
    .in(
      "id",
      sources.map((s) => s.research_item_id)
    );
  if (error) throw error;

  const byId = new Map((researchItems as ResearchItem[]).map((r) => [r.id, r]));
  return sources
    .map((source) => {
      const researchItem = byId.get(source.research_item_id);
      return researchItem ? { source, researchItem } : null;
    })
    .filter((v): v is { source: IdeaSource; researchItem: ResearchItem } => v !== null);
}
