import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperienceConfidence, ExperienceLibraryItem } from "@/lib/growth-os/types";

export async function listExperienceLibrary(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_experience_library")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExperienceLibraryItem[];
}

/** AI各AgentへExperience Libraryを渡す際は、原則VERIFIED_BY_USER(本人が「これは本当」と確認済み)のみ使う。 */
export async function listVerifiedExperienceLibrary(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_experience_library")
    .select("*")
    .eq("user_id", userId)
    .eq("confidence", "VERIFIED_BY_USER")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExperienceLibraryItem[];
}

export async function getExperienceLibraryItem(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_experience_library")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ExperienceLibraryItem | null;
}

export interface CreateExperienceInput {
  title: string;
  summary: string;
  tags?: string[];
  confidence?: ExperienceConfidence;
}

export async function createExperienceLibraryItem(
  supabase: SupabaseClient,
  userId: string,
  input: CreateExperienceInput
) {
  const { data, error } = await supabase
    .from("gos_experience_library")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as ExperienceLibraryItem;
}

export async function updateExperienceConfidence(
  supabase: SupabaseClient,
  id: string,
  confidence: ExperienceConfidence
) {
  const { data, error } = await supabase
    .from("gos_experience_library")
    .update({ confidence })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ExperienceLibraryItem;
}

export async function deleteExperienceLibraryItem(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("gos_experience_library").delete().eq("id", id);
  if (error) throw error;
}
