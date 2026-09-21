import type { SupabaseClient } from "@supabase/supabase-js";
import type { HarmType, ResearchItem, ResearchSourceType, ResearchStatus } from "@/lib/growth-os/types";

export interface CreateResearchItemInput {
  source_type: ResearchSourceType;
  source_name: string;
  source_url?: string | null;
  keyword?: string | null;
  title: string;
  summary?: string | null;
  raw_text?: string | null;
  target_age_min?: number | null;
  target_age_max?: number | null;
  collected_at?: string;
}

export interface ResearchListFilters {
  search?: string;
  sourceType?: ResearchSourceType;
  harmType?: HarmType;
  collectedFrom?: string;
  collectedTo?: string;
  minTrendScore?: number;
  minPainScore?: number;
}

export async function listResearchItems(supabase: SupabaseClient, userId: string, filters: ResearchListFilters = {}) {
  let query = supabase.from("gos_research_items").select("*").eq("user_id", userId);

  if (filters.search) {
    query = query.or(`title.ilike.%${filters.search}%,keyword.ilike.%${filters.search}%`);
  }
  if (filters.sourceType) {
    query = query.eq("source_type", filters.sourceType);
  }
  if (filters.harmType) {
    query = query.contains("harm_types", [filters.harmType]);
  }
  if (filters.collectedFrom) {
    query = query.gte("collected_at", filters.collectedFrom);
  }
  if (filters.collectedTo) {
    query = query.lte("collected_at", filters.collectedTo);
  }
  if (filters.minTrendScore !== undefined) {
    query = query.gte("trend_score", filters.minTrendScore);
  }
  if (filters.minPainScore !== undefined) {
    query = query.gte("pain_score", filters.minPainScore);
  }

  const { data, error } = await query.order("collected_at", { ascending: false });
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

export async function getResearchItemsByIds(supabase: SupabaseClient, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("gos_research_items").select("*").eq("user_id", userId).in("id", ids);
  if (error) throw error;
  return (data ?? []) as ResearchItem[];
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

export async function updateResearchAnalysis(
  supabase: SupabaseClient,
  id: string,
  patch: {
    harm_types: HarmType[];
    surface_problem: string;
    deep_problem: string;
    emotional_trigger: string;
    trend_score: number;
    pain_score: number;
    content_hash: string;
    analysis_version: number;
  }
) {
  const { data, error } = await supabase
    .from("gos_research_items")
    .update({ ...patch, status: "REVIEWED", last_analyzed_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ResearchItem;
}

export async function markResearchPromoted(supabase: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from("gos_research_items").update({ status: "PROMOTED" }).in("id", ids);
  if (error) throw error;
}

export async function updateResearchStatus(supabase: SupabaseClient, id: string, status: ResearchStatus) {
  const { error } = await supabase.from("gos_research_items").update({ status }).eq("id", id);
  if (error) throw error;
}
