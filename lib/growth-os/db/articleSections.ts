import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleSection } from "@/lib/growth-os/types";
import type { OutlineResponse } from "@/lib/growth-os/ai/schemas";

export async function listArticleSections(supabase: SupabaseClient, userId: string, articleId: string) {
  const { data, error } = await supabase
    .from("gos_article_sections")
    .select("*")
    .eq("user_id", userId)
    .eq("article_id", articleId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ArticleSection[];
}

export async function getArticleSection(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_article_sections")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ArticleSection | null;
}

/** Outline承認時に、Outlineのsections配列からSectionの骨格行を一括作成する(本文はまだ空)。 */
export async function createSectionsFromOutline(
  supabase: SupabaseClient,
  userId: string,
  articleId: string,
  sections: OutlineResponse["sections"]
) {
  const { data, error } = await supabase
    .from("gos_article_sections")
    .insert(
      sections.map((s, index) => ({
        user_id: userId,
        article_id: articleId,
        heading: s.heading,
        purpose: s.purpose,
        key_points: s.key_points,
        evidence_required: s.evidence_required,
        experience_required: s.experience_required,
        sort_order: index,
      }))
    )
    .select("*");

  if (error) throw error;
  return (data ?? []) as ArticleSection[];
}

export interface SectionDraftPatch {
  content: string;
  source_ids: string[];
  experience_ids: string[];
}

/** AIによるSection本文の(再)生成。manual_edited済みのSectionは呼び出し側で除外してから呼ぶこと。 */
export async function applySectionDraft(supabase: SupabaseClient, id: string, patch: SectionDraftPatch) {
  const { data, error } = await supabase
    .from("gos_article_sections")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ArticleSection;
}

/** 人間による手動編集。以降このSectionはAI再生成の対象から外れる(manual_edited=true)。 */
export async function applyManualSectionEdit(supabase: SupabaseClient, id: string, content: string) {
  const { data, error } = await supabase
    .from("gos_article_sections")
    .update({ content, manual_edited: true })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ArticleSection;
}

export function assembleBodyMarkdown(sections: ArticleSection[]): string {
  return sections
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => `## ${s.heading}\n\n${s.content}`)
    .join("\n\n");
}
