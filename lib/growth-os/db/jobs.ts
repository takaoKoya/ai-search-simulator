import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiJob, AiJobTargetType, AiJobType } from "@/lib/growth-os/types";

export async function enqueueJob(
  supabase: SupabaseClient,
  userId: string,
  jobType: AiJobType,
  targetType: AiJobTargetType,
  targetId: string,
  payload: Record<string, unknown> = {}
) {
  const { data, error } = await supabase
    .from("gos_ai_jobs")
    .insert({ user_id: userId, job_type: jobType, target_type: targetType, target_id: targetId, payload })
    .select("*")
    .single();

  if (error) throw error;
  return data as AiJob;
}

/** RLSを迂回してキュー全体から1件だけ排他的に取り出す。Service Role clientでのみ呼ぶこと。 */
export async function dequeueNextJob(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("gos_dequeue_next_job");
  if (error) throw error;
  return (data ?? null) as AiJob | null;
}

export async function completeJob(supabase: SupabaseClient, id: string, result: unknown) {
  const { error } = await supabase.from("gos_ai_jobs").update({ status: "SUCCEEDED", result }).eq("id", id);
  if (error) throw error;
}

export async function failJob(supabase: SupabaseClient, job: AiJob, errorMessage: string) {
  const status = job.attempt_count >= job.max_attempts ? "FAILED" : "PENDING";
  const { error } = await supabase
    .from("gos_ai_jobs")
    .update({ status, error: errorMessage })
    .eq("id", job.id);
  if (error) throw error;
}

export async function listJobsForTarget(supabase: SupabaseClient, userId: string, targetId: string) {
  const { data, error } = await supabase
    .from("gos_ai_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as AiJob[];
}

export async function countPendingJobs(supabase: SupabaseClient, userId: string) {
  const { count, error } = await supabase
    .from("gos_ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["PENDING", "RUNNING"]);

  if (error) throw error;
  return count ?? 0;
}
