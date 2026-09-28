import type { SupabaseClient } from "@supabase/supabase-js";
import type { WritingProfile, WritingSample } from "@/lib/growth-os/types";

export async function getWritingProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_writing_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as WritingProfile | null;
}

export interface WritingProfileInput {
  preferred_tone: string;
  sentence_length: WritingProfile["sentence_length"];
  humor_level: number;
  directness: number;
  emotional_level: number;
  technical_level: number;
  emoji_level: number;
  line_break_style: WritingProfile["line_break_style"];
  ng_phrases: string[];
  preferred_phrases: string[];
}

/** Writing Profileは1ユーザー1行(unique(user_id))なのでupsertで一本化する。 */
export async function upsertWritingProfile(supabase: SupabaseClient, userId: string, input: WritingProfileInput) {
  const { data, error } = await supabase
    .from("gos_writing_profiles")
    .upsert({ ...input, user_id: userId }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data as WritingProfile;
}

export async function listWritingSamples(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_writing_samples")
    .select("*")
    .eq("user_id", userId)
    .order("approved_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as WritingSample[];
}

export async function addWritingSample(
  supabase: SupabaseClient,
  userId: string,
  input: { source_type: WritingSample["source_type"]; source_id: string; excerpt: string }
) {
  const { data, error } = await supabase
    .from("gos_writing_samples")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as WritingSample;
}
