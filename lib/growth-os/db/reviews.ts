import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentType, AiReview, AiReviewTargetType, AiReviewVerdict } from "@/lib/growth-os/types";

export interface InsertAiReviewInput {
  target_type: AiReviewTargetType;
  target_id: string;
  agent_type: AgentType;
  revision_number?: number;
  score?: number | null;
  verdict?: AiReviewVerdict | null;
  feedback?: string | null;
  raw_response?: unknown;
}

// gos_ai_reviews は追記のみ(UPDATE/DELETEポリシーなし)。常にinsertで新しい評価行を積む。
export async function insertAiReview(supabase: SupabaseClient, userId: string, input: InsertAiReviewInput) {
  const { data, error } = await supabase
    .from("gos_ai_reviews")
    .insert({ ...input, user_id: userId, revision_number: input.revision_number ?? 0 })
    .select("*")
    .single();

  if (error) throw error;
  return data as AiReview;
}

export async function listAiReviewsForTarget(
  supabase: SupabaseClient,
  userId: string,
  targetType: AiReviewTargetType,
  targetId: string
) {
  const { data, error } = await supabase
    .from("gos_ai_reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as AiReview[];
}
