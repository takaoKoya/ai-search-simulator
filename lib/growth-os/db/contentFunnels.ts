import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentFunnel } from "@/lib/growth-os/types";

export async function getContentFunnelByIdea(supabase: SupabaseClient, userId: string, ideaId: string) {
  const { data, error } = await supabase
    .from("gos_content_funnels")
    .select("*")
    .eq("user_id", userId)
    .eq("idea_id", ideaId)
    .maybeSingle();

  if (error) throw error;
  return data as ContentFunnel | null;
}

/** Idea起点のThreads→FreeNote→PaidNote→Product追跡行を無ければ作成する。 */
async function ensureContentFunnel(supabase: SupabaseClient, userId: string, ideaId: string) {
  const existing = await getContentFunnelByIdea(supabase, userId, ideaId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("gos_content_funnels")
    .insert({ user_id: userId, idea_id: ideaId })
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentFunnel;
}

export async function addThreadsPostToFunnel(supabase: SupabaseClient, userId: string, ideaId: string, threadsPostId: string) {
  const funnel = await ensureContentFunnel(supabase, userId, ideaId);
  if (funnel.threads_post_ids.includes(threadsPostId)) return funnel;

  const { data, error } = await supabase
    .from("gos_content_funnels")
    .update({ threads_post_ids: [...funnel.threads_post_ids, threadsPostId] })
    .eq("id", funnel.id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentFunnel;
}

export async function setFunnelFreeNote(supabase: SupabaseClient, userId: string, ideaId: string, freeNoteId: string) {
  const funnel = await ensureContentFunnel(supabase, userId, ideaId);
  const { data, error } = await supabase
    .from("gos_content_funnels")
    .update({ free_note_id: freeNoteId })
    .eq("id", funnel.id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentFunnel;
}

export async function setFunnelPaidNote(supabase: SupabaseClient, userId: string, ideaId: string, paidNoteId: string) {
  const funnel = await ensureContentFunnel(supabase, userId, ideaId);
  const { data, error } = await supabase
    .from("gos_content_funnels")
    .update({ paid_note_id: paidNoteId })
    .eq("id", funnel.id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentFunnel;
}

export async function setFunnelProduct(supabase: SupabaseClient, userId: string, ideaId: string, productId: string) {
  const funnel = await ensureContentFunnel(supabase, userId, ideaId);
  const { data, error } = await supabase
    .from("gos_content_funnels")
    .update({ product_id: productId })
    .eq("id", funnel.id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentFunnel;
}
