import type { SupabaseClient } from "@supabase/supabase-js";
import type { HarmType, ResearchItem, ResearchStatus } from "@/lib/growth-os/types";

export interface CreateResearchItemInput {
  source: string;
  source_url?: string | null;
  keyword?: string | null;
  title: string;
  summary?: string | null;
  target_age?: string | null;
}

export async function listResearchItems(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_research_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ResearchItem[];
}

export async function getResearchItem(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_research_items")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ResearchItem | null;
}

export async function createResearchItem(
  supabase: SupabaseClient,
  userId: string,
  input: CreateResearchItemInput
) {
  const { data, error } = await supabase
    .from("gos_research_items")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as ResearchItem;
}

export async function updateResearchClassification(
  supabase: SupabaseClient,
  id: string,
  patch: { harm_type: HarmType[]; trend_score: number; pain_score: number; status?: ResearchStatus }
) {
  const { data, error } = await supabase
    .from("gos_research_items")
    .update({ ...patch, status: patch.status ?? "REVIEWED" })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ResearchItem;
}

export async function markResearchPromoted(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("gos_research_items").update({ status: "PROMOTED" }).eq("id", id);
  if (error) throw error;
}
