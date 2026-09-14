import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteArticle, NoteArticleStage, NoteArticleStatus, NoteArticleType } from "@/lib/growth-os/types";

export interface CreateArticleInput {
  idea_id?: string | null;
  type: NoteArticleType;
  price?: number | null;
  title: string;
}

export async function listNoteArticles(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NoteArticle[];
}

export async function getNoteArticle(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as NoteArticle | null;
}

export async function createNoteArticle(supabase: SupabaseClient, userId: string, input: CreateArticleInput) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .insert({ ...input, user_id: userId, status: "RESEARCHED" })
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

export async function advanceArticleStage(
  supabase: SupabaseClient,
  id: string,
  patch: {
    current_stage: NoteArticleStage;
    status: NoteArticleStatus;
    body_markdown?: string;
    title?: string;
    quality_score?: number | null;
    quality_below_threshold?: boolean;
    revision_count?: number;
  }
) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

export async function publishNoteArticle(supabase: SupabaseClient, id: string, noteUrl?: string | null) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .update({ status: "PUBLISHED", published_at: new Date().toISOString(), note_url: noteUrl ?? null })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

export async function listPublishedFreeArticles(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "FREE")
    .eq("status", "PUBLISHED")
    .order("published_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NoteArticle[];
}
