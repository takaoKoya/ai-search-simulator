"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { createResearchItem, markResearchPromoted, getResearchItem } from "@/lib/growth-os/db/research";
import { createIdea, updateIdeaStatus, getIdea } from "@/lib/growth-os/db/ideas";
import { updateThreadsPostStatus } from "@/lib/growth-os/db/threads";
import { createNoteArticle, getNoteArticle, publishNoteArticle } from "@/lib/growth-os/db/articles";
import { enqueueJob, countPendingJobs } from "@/lib/growth-os/db/jobs";
import { updateProductStatus } from "@/lib/growth-os/db/products";
import { upsertContentMetric, listContentMetrics } from "@/lib/growth-os/db/metrics";
import { createCalendarItem } from "@/lib/growth-os/db/calendar";
import { getDailyAiJobLimit, countJobsCreatedToday, SETTINGS_KEYS, upsertSetting } from "@/lib/growth-os/db/settings";
import {
  GROWTH_OS_DASHBOARD_ROUTE,
  GROWTH_OS_RESEARCH_ROUTE,
  GROWTH_OS_IDEAS_ROUTE,
  GROWTH_OS_THREADS_ROUTE,
  GROWTH_OS_NOTE_ROUTE,
  GROWTH_OS_PRODUCTS_ROUTE,
  GROWTH_OS_CALENDAR_ROUTE,
  GROWTH_OS_ANALYTICS_ROUTE,
  GROWTH_OS_SETTINGS_ROUTE,
} from "@/lib/routes";
import type { CalendarItemType, IdeaStatus, MetricContentType, ProductStatus, ThreadsPostStatus } from "@/lib/growth-os/types";

async function assertUnderDailyJobLimit(supabase: Awaited<ReturnType<typeof requireGrowthOsUser>>["supabase"], userId: string) {
  const [limit, createdToday] = await Promise.all([
    getDailyAiJobLimit(supabase, userId),
    countJobsCreatedToday(supabase, userId),
  ]);
  if (createdToday >= limit) {
    throw new Error(
      `本日のAIジョブ上限(${limit}件)に達しました。Settings画面で上限を調整するか、明日以降に再実行してください。`
    );
  }
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export async function createResearchItemAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("タイトルは必須です");

  const item = await createResearchItem(supabase, userId, {
    source: String(formData.get("source") ?? "手動入力"),
    source_url: (formData.get("source_url") as string) || null,
    keyword: (formData.get("keyword") as string) || null,
    title,
    summary: (formData.get("summary") as string) || null,
    target_age: (formData.get("target_age") as string) || null,
  });

  revalidatePath(GROWTH_OS_RESEARCH_ROUTE);
  redirect(`${GROWTH_OS_RESEARCH_ROUTE}/${item.id}`);
}

export async function runResearchClassifyAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "RESEARCH_CLASSIFY", "RESEARCH_ITEM", id);
  revalidatePath(`${GROWTH_OS_RESEARCH_ROUTE}/${id}`);
}

export async function promoteResearchToIdeaAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  const item = await getResearchItem(supabase, userId, id);
  if (!item) throw new Error("Research item not found");

  const idea = await createIdea(supabase, userId, {
    research_item_id: item.id,
    title: item.title,
    summary: item.summary,
  });
  await markResearchPromoted(supabase, id);

  revalidatePath(GROWTH_OS_RESEARCH_ROUTE);
  revalidatePath(GROWTH_OS_IDEAS_ROUTE);
  redirect(`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`);
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

export async function createIdeaManuallyAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("タイトルは必須です");

  const idea = await createIdea(supabase, userId, { title, summary: (formData.get("summary") as string) || null });
  revalidatePath(GROWTH_OS_IDEAS_ROUTE);
  redirect(`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`);
}

export async function runIdeaScoreAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "IDEA_SCORE", "IDEA", id);
  revalidatePath(`${GROWTH_OS_IDEAS_ROUTE}/${id}`);
}

async function setIdeaStatus(id: string, status: IdeaStatus) {
  const { supabase } = await requireGrowthOsUser();
  await updateIdeaStatus(supabase, id, status);
  revalidatePath(GROWTH_OS_DASHBOARD_ROUTE);
  revalidatePath(GROWTH_OS_IDEAS_ROUTE);
  revalidatePath(`${GROWTH_OS_IDEAS_ROUTE}/${id}`);
}

export async function holdIdeaAction(id: string) {
  await setIdeaStatus(id, "ON_HOLD");
}

export async function rejectIdeaAction(id: string) {
  await setIdeaStatus(id, "REJECTED");
}

export async function approveIdeaForThreadsAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await updateIdeaStatus(supabase, id, "APPROVED_FOR_THREADS");
  await enqueueJob(supabase, userId, "THREADS_GENERATE", "IDEA", id);
  revalidatePath(GROWTH_OS_DASHBOARD_ROUTE);
  revalidatePath(GROWTH_OS_IDEAS_ROUTE);
  redirect(`${GROWTH_OS_THREADS_ROUTE}?idea=${id}`);
}

async function approveIdeaForNote(id: string, type: "FREE" | "PAID") {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  const idea = await getIdea(supabase, userId, id);
  if (!idea) throw new Error("Idea not found");

  await updateIdeaStatus(supabase, id, type === "FREE" ? "APPROVED_FOR_NOTE_FREE" : "APPROVED_FOR_NOTE_PAID");

  const article = await createNoteArticle(supabase, userId, {
    idea_id: idea.id,
    type,
    title: idea.title,
  });

  await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id);

  revalidatePath(GROWTH_OS_DASHBOARD_ROUTE);
  revalidatePath(GROWTH_OS_IDEAS_ROUTE);
  redirect(`${GROWTH_OS_NOTE_ROUTE}/${article.id}`);
}

export async function approveIdeaForNoteFreeAction(id: string) {
  await approveIdeaForNote(id, "FREE");
}

export async function approveIdeaForNotePaidAction(id: string) {
  await approveIdeaForNote(id, "PAID");
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function regenerateThreadsAction(ideaId: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "THREADS_GENERATE", "IDEA", ideaId);
  revalidatePath(GROWTH_OS_THREADS_ROUTE);
}

async function setThreadsStatus(id: string, status: ThreadsPostStatus) {
  const { supabase } = await requireGrowthOsUser();
  await updateThreadsPostStatus(supabase, id, status);
  revalidatePath(GROWTH_OS_THREADS_ROUTE);
  revalidatePath(`${GROWTH_OS_THREADS_ROUTE}/${id}`);
}

export async function approveThreadsPostAction(id: string) {
  await setThreadsStatus(id, "APPROVED");
}

export async function rejectThreadsPostAction(id: string) {
  await setThreadsStatus(id, "REJECTED");
}

export async function markThreadsPostPublishedAction(id: string) {
  // V1のPublisher Adapterは手動運用: 人間がThreadsに貼り付けた後にこのボタンで記録する。
  await setThreadsStatus(id, "PUBLISHED");
}

// ---------------------------------------------------------------------------
// note
// ---------------------------------------------------------------------------

export async function retryArticlePipelineAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);

  const pending = await countPendingJobs(supabase, userId);
  if (pending > 0) {
    // 既に処理待ちのジョブがある場合は二重登録しない。
    revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
    return;
  }

  await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", id);
  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
}

export async function approveArticleAction(id: string) {
  const { supabase } = await requireGrowthOsUser();
  const { error } = await supabase.from("gos_note_articles").update({ status: "APPROVED" }).eq("id", id);
  if (error) throw error;
  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
}

export async function publishArticleAction(formData: FormData) {
  const { supabase } = await requireGrowthOsUser();
  const id = String(formData.get("id"));
  const noteUrl = (formData.get("note_url") as string) || null;
  await publishNoteArticle(supabase, id, noteUrl);
  revalidatePath(GROWTH_OS_NOTE_ROUTE);
  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function generateProductSuggestionAction(articleId: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);

  const article = await getNoteArticle(supabase, userId, articleId);
  if (!article) throw new Error("Article not found");

  const metrics = await listContentMetrics(supabase, userId);
  const latest = metrics.filter((m) => m.content_id === articleId).at(-1);

  await enqueueJob(supabase, userId, "PRODUCT_SUGGEST", "NOTE_ARTICLE", articleId, {
    pv: latest?.pv ?? 0,
    likes: latest?.likes ?? 0,
  });

  revalidatePath(GROWTH_OS_PRODUCTS_ROUTE);
}

export async function updateProductStatusAction(id: string, status: ProductStatus) {
  const { supabase } = await requireGrowthOsUser();
  await updateProductStatus(supabase, id, status);
  revalidatePath(GROWTH_OS_PRODUCTS_ROUTE);
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function addCalendarItemAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const [itemType, refId] = String(formData.get("item")).split("|");
  await createCalendarItem(supabase, userId, {
    item_type: itemType as CalendarItemType,
    ref_id: refId,
    scheduled_date: String(formData.get("scheduled_date")),
    scheduled_time: (formData.get("scheduled_time") as string) || null,
  });
  revalidatePath(GROWTH_OS_CALENDAR_ROUTE);
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export async function addMetricAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const [contentType, contentId] = String(formData.get("content")).split("|");
  await upsertContentMetric(supabase, userId, {
    content_type: contentType as MetricContentType,
    content_id: contentId,
    metric_date: String(formData.get("metric_date")),
    pv: Number(formData.get("pv") ?? 0),
    likes: Number(formData.get("likes") ?? 0),
    follower_delta: Number(formData.get("follower_delta") ?? 0),
    sales_amount: Number(formData.get("sales_amount") ?? 0),
    purchase_count: Number(formData.get("purchase_count") ?? 0),
    theme_tag: (formData.get("theme_tag") as string) || null,
  });
  revalidatePath(GROWTH_OS_ANALYTICS_ROUTE);
}

export async function runAnalyticsAdviseAction() {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "ANALYTICS_ADVISE", "ANALYTICS", userId);
  revalidatePath(GROWTH_OS_ANALYTICS_ROUTE);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateDailyJobLimitAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const limit = Number(formData.get("daily_ai_job_limit") ?? 30);
  await upsertSetting(supabase, userId, SETTINGS_KEYS.DAILY_AI_JOB_LIMIT, limit);
  revalidatePath(GROWTH_OS_SETTINGS_ROUTE);
}
