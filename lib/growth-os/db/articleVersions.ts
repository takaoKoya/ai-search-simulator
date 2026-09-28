import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleVersion } from "@/lib/growth-os/types";

export async function listVersions(
  supabase: SupabaseClient,
  userId: string,
  targetType: ArticleVersion["target_type"],
  targetId: string
) {
  const { data, error } = await supabase
    .from("gos_article_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("version", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ArticleVersion[];
}

/**
 * 新しい版を追加する(version番号はDBの現在の最大値+1を自分で計算する)。
 * AIが上書きする直前・人間が手動編集する直前の両方でこれを呼び、
 * 「AI再生成が手動編集を黙って消す」ことがないよう常に前バージョンを残す。
 */
export async function saveVersion(
  supabase: SupabaseClient,
  userId: string,
  input: {
    target_type: ArticleVersion["target_type"];
    target_id: string;
    content: string;
    created_by: ArticleVersion["created_by"];
    reason?: string | null;
  }
) {
  const { data: latest, error: latestError } = await supabase
    .from("gos_article_versions")
    .select("version")
    .eq("user_id", userId)
    .eq("target_type", input.target_type)
    .eq("target_id", input.target_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("gos_article_versions")
    .insert({
      user_id: userId,
      target_type: input.target_type,
      target_id: input.target_id,
      version: nextVersion,
      content: input.content,
      created_by: input.created_by,
      reason: input.reason ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as ArticleVersion;
}

export async function getVersion(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_article_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as ArticleVersion | null;
}
