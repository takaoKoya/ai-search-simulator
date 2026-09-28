import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CtaType,
  NoteArticle,
  NoteArticleStatus,
  NoteArticleType,
  PaidCandidateEvaluation,
  TitleCandidate,
} from "@/lib/growth-os/types";
import { assertTransition } from "@/lib/growth-os/contentStatus";

export interface CreateArticleInput {
  idea_id?: string | null;
  strategy_id?: string | null;
  type: NoteArticleType;
  price?: number | null;
  title: string;
}

export async function listNoteArticles(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NoteArticle[];
}

export async function getNoteArticle(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as NoteArticle | null;
}

export async function listArticlesByIdea(supabase: SupabaseClient, userId: string, ideaId: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .eq("idea_id", ideaId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as NoteArticle[];
}

export async function createNoteArticle(supabase: SupabaseClient, userId: string, input: CreateArticleInput) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .insert({ ...input, user_id: userId, status: "STRATEGY" })
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

/**
 * Content StatusのService層経由での遷移。呼び出し側は必ずこの関数を使い、
 * 直接 .update({status}) しないこと(不正な遷移をassertTransitionで防ぐ)。
 */
export async function transitionArticleStatus(
  supabase: SupabaseClient,
  article: Pick<NoteArticle, "id" | "status">,
  to: NoteArticleStatus,
  extraPatch: Record<string, unknown> = {}
) {
  assertTransition(article.status, to);
  const { data, error } = await supabase
    .from("gos_note_articles")
    .update({ status: to, ...extraPatch })
    .eq("id", article.id)
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

export interface OutlinePatch {
  title: string;
  title_candidates: TitleCandidate[];
  lead: string;
  reader_problem: string;
  promise: string;
  cta_type: CtaType;
  cta_text: string;
}

/** Outline生成直後、STRATEGY→OUTLINEへ遷移させつつタイトル案・リード文・CTAを保存する。 */
export async function applyOutline(
  supabase: SupabaseClient,
  article: Pick<NoteArticle, "id" | "status">,
  patch: OutlinePatch
) {
  return transitionArticleStatus(supabase, article, "OUTLINE", { ...patch });
}

/** 人間がOutlineを承認し、本文生成(Section単位)へ進める。 */
export async function approveOutline(supabase: SupabaseClient, article: Pick<NoteArticle, "id" | "status">) {
  return transitionArticleStatus(supabase, article, "DRAFT", {
    outline_approved_at: new Date().toISOString(),
  });
}

export async function updateArticleBody(supabase: SupabaseClient, id: string, bodyMarkdown: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .update({ body_markdown: bodyMarkdown })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

export interface ReviewResultPatch {
  quality_score: number;
  quality_below_threshold: boolean;
  revision_count?: number;
}

export async function applyReviewResult(
  supabase: SupabaseClient,
  article: Pick<NoteArticle, "id" | "status">,
  to: NoteArticleStatus,
  patch: ReviewResultPatch
) {
  return transitionArticleStatus(supabase, article, to, { ...patch });
}

export async function incrementRevisionCount(supabase: SupabaseClient, id: string) {
  const { data: current, error: readError } = await supabase
    .from("gos_note_articles")
    .select("revision_count")
    .eq("id", id)
    .single();
  if (readError) throw readError;

  const { data: updated, error: updateError } = await supabase
    .from("gos_note_articles")
    .update({ revision_count: (current.revision_count ?? 0) + 1 })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return updated as NoteArticle;
}

export async function setPaidCandidateEvaluation(
  supabase: SupabaseClient,
  id: string,
  evaluation: PaidCandidateEvaluation
) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .update({ is_paid_candidate: evaluation.is_paid_candidate, paid_candidate_evaluation: evaluation })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

export async function publishNoteArticle(supabase: SupabaseClient, id: string, noteUrl?: string | null) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .update({ status: "PUBLISHED", published_at: new Date().toISOString(), note_url: noteUrl ?? null })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as NoteArticle;
}

export async function listPublishedFreeArticles(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "FREE")
    .eq("status", "PUBLISHED")
    .order("published_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NoteArticle[];
}

/** Approval Queue(セクション23)向け: WAITING_APPROVAL状態の記事を一覧する。 */
export async function listArticlesAwaitingApproval(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["OUTLINE", "WAITING_APPROVAL"])
    .order("updated_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as NoteArticle[];
}
