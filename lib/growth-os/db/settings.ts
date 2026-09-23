import type { SupabaseClient } from "@supabase/supabase-js";

export const SETTINGS_KEYS = {
  DAILY_AI_JOB_LIMIT: "daily_ai_job_limit",
  IDEA_SCORE_WEIGHTS: "idea_score_weights",
  ANALYTICS_RECOMMENDATION: "analytics_recommendation",
} as const;

export async function getSetting<T = unknown>(supabase: SupabaseClient, userId: string, key: string) {
  const { data, error } = await supabase
    .from("gos_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();

  if (error) throw error;
  return (data?.value ?? null) as T | null;
}

export async function listSettings(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("gos_settings").select("*").eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function upsertSetting(supabase: SupabaseClient, userId: string, key: string, value: unknown) {
  const { data, error } = await supabase
    .from("gos_settings")
    .upsert({ user_id: userId, key, value }, { onConflict: "user_id,key" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/** 1日あたりのAIジョブ生成上限。未設定時のデフォルトは30件。 */
export async function getDailyAiJobLimit(supabase: SupabaseClient, userId: string): Promise<number> {
  const value = await getSetting<number>(supabase, userId, SETTINGS_KEYS.DAILY_AI_JOB_LIMIT);
  return value ?? 30;
}

export async function countJobsCreatedToday(supabase: SupabaseClient, userId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("gos_ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString());

  if (error) throw error;
  return count ?? 0;
}
