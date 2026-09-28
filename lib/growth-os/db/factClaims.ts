import type { SupabaseClient } from "@supabase/supabase-js";
import type { FactClaim } from "@/lib/growth-os/types";

export async function listFactClaims(supabase: SupabaseClient, userId: string, articleId: string) {
  const { data, error } = await supabase
    .from("gos_fact_claims")
    .select("*")
    .eq("user_id", userId)
    .eq("article_id", articleId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as FactClaim[];
}

export interface FactClaimInsert {
  article_id: string;
  section_id: string | null;
  claim: string;
  classification: FactClaim["classification"];
  source_id: string | null;
  confidence: number | null;
  action_required: boolean;
}

/** gos_fact_claims は追記のみ(監査証跡)。再Fact Check時は新しい行として積み増す。 */
export async function insertFactClaims(supabase: SupabaseClient, userId: string, claims: FactClaimInsert[]) {
  if (claims.length === 0) return [] as FactClaim[];
  const { data, error } = await supabase
    .from("gos_fact_claims")
    .insert(claims.map((c) => ({ ...c, user_id: userId })))
    .select("*");

  if (error) throw error;
  return (data ?? []) as FactClaim[];
}
