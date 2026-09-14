import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BackgroundJobResult<T> {
  ran: boolean;
  result?: T;
  error?: string;
}

/**
 * Job Idempotency (spec §72-73): every scheduled job claims a lock row in
 * `background_jobs` (keyed by `job_key`) before doing any work and releases
 * it when done, recording last_run_at/last_success_at/last_status/
 * last_error — so an overlapping trigger (a slow previous run, two
 * schedulers) never runs the same job concurrently, and a failure is
 * visible rather than silently swallowed. This table is
 * RLS-locked-with-zero-policies (see the Phase 5 migration), so this is
 * one of only two places in this codebase that use the service-role
 * client — a scheduled job has no human session to derive RLS context
 * from.
 */
export async function runBackgroundJob<T>(supabase: SupabaseClient, jobKey: string, fn: () => Promise<T>): Promise<BackgroundJobResult<T>> {
  await supabase.from("background_jobs").upsert({ job_key: jobKey }, { onConflict: "job_key", ignoreDuplicates: true });

  const { data: current } = await supabase.from("background_jobs").select("id, locked_at").eq("job_key", jobKey).maybeSingle();
  if (!current) return { ran: false, error: "Failed to create background_jobs row" };
  if (current.locked_at) return { ran: false, error: "Job already running" };

  const lockToken = randomUUID();
  await supabase.from("background_jobs").update({ locked_at: new Date().toISOString(), lock_token: lockToken }).eq("id", current.id as string);

  try {
    const result = await fn();
    await supabase
      .from("background_jobs")
      .update({ locked_at: null, lock_token: null, last_run_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_status: "SUCCESS", last_error: null })
      .eq("id", current.id as string);
    return { ran: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("background_jobs").update({ locked_at: null, lock_token: null, last_run_at: new Date().toISOString(), last_status: "FAILED", last_error: message }).eq("id", current.id as string);
    return { ran: false, error: message };
  }
}
