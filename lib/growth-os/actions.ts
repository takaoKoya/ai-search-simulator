"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { createResearchItem, getResearchItemsByIds } from "@/lib/growth-os/db/research";
import { createIdeaManually, updateIdeaStatus, getIdea } from "@/lib/growth-os/db/ideas";
import {
  updateThreadsPostStatus,
  applyManualThreadsEdit,
  getThreadsPost,
} from "@/lib/growth-os/db/threads";
import {
  createNoteArticle,
  getNoteArticle,
  publishNoteArticle,
  transitionArticleStatus,
} from "@/lib/growth-os/db/articles";
import { approveOutlineAndStartDraft } from "@/lib/growth-os/pipeline/articlePipeline";
import { getArticleSection, applyManualSectionEdit, assembleBodyMarkdown, listArticleSections } from "@/lib/growth-os/db/articleSections";
import { updateArticleBody } from "@/lib/growth-os/db/articles";
import { saveVersion, getVersion } from "@/lib/growth-os/db/articleVersions";
import {
  createExperienceLibraryItem,
  updateExperienceConfidence,
  deleteExperienceLibraryItem,
} from "@/lib/growth-os/db/experienceLibrary";
import { upsertWritingProfile, addWritingSample } from "@/lib/growth-os/db/writingProfile";
import { enqueueJob, countPendingJobs } from "@/lib/growth-os/db/jobs";
import { updateProductStatus } from "@/lib/growth-os/db/products";
import { upsertContentMetric, listContentMetrics } from "@/lib/growth-os/db/metrics";
import { createCalendarItem } from "@/lib/growth-os/db/calendar";
import { getDailyAiJobLimit, countJobsCreatedToday, SETTINGS_KEYS, upsertSetting } from "@/lib/growth-os/db/settings";
import { parseHttpUrl } from "@/lib/growth-os/validation";
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
  GROWTH_OS_APPROVAL_ROUTE,
  GROWTH_OS_EXPERIENCE_ROUTE,
} from "@/lib/routes";
import type {
  CalendarItemType,
  ExperienceConfidence,
  IdeaStatus,
  MetricContentType,
  ProductStatus,
  ResearchSourceType,
  ThreadsPostStatus,
  WritingProfile,
} from "@/lib/growth-os/types";

type GrowthOsSupabase = Awaited<ReturnType<typeof requireGrowthOsUser>>["supabase"];

async function assertUnderDailyJobLimit(supabase: GrowthOsSupabase, userId: string) {
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

  const sourceName = String(formData.get("source_name") ?? "").trim();
  if (!sourceName) throw new Error("出典名は必須です");

  const sourceUrl = parseHttpUrl(formData.get("source_url") as string | null);

  const ageMinRaw = formData.get("target_age_min") as string | null;
  const ageMaxRaw = formData.get("target_age_max") as string | null;
  const targetAgeMin = ageMinRaw ? Number(ageMinRaw) : null;
  const targetAgeMax = ageMaxRaw ? Number(ageMaxRaw) : null;
  if (targetAgeMin !== null && targetAgeMax !== null && targetAgeMin > targetAgeMax) {
    throw new Error("対象年齢は最小値が最大値以下になるようにしてください");
  }

  const item = await createResearchItem(supabase, userId, {
    source_type: String(formData.get("source_type") ?? "MANUAL") as ResearchSourceType,
    source_name: sourceName,
    source_url: sourceUrl,
    keyword: (formData.get("keyword") as string) || null,
    title,
    summary: (formData.get("summary") as string) || null,
    raw_text: (formData.get("raw_text") as string) || null,
    target_age_min: targetAgeMin,
    target_age_max: targetAgeMax,
  });

  revalidatePath(GROWTH_OS_RESEARCH_ROUTE);
  redirect(`${GROWTH_OS_RESEARCH_ROUTE}/${item.id}`);
}

export async function runResearchAnalysisAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "RESEARCH_CLASSIFY", "RESEARCH_ITEM", id);
  revalidatePath(`${GROWTH_OS_RESEARCH_ROUTE}/${id}`);
}

/** 単一/複数のResearchを選択してIdea候補をAI生成する(セクション6・10)。 */
export async function generateIdeasFromResearchAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);

  const ids = formData.getAll("research_ids").map(String).filter(Boolean);
  if (ids.length === 0) throw new Error("Researchを1件以上選択してください");

  const items = await getResearchItemsByIds(supabase, userId, ids);
  if (items.length === 0) throw new Error("選択したResearchが見つかりません");

  if (items.length === 1) {
    await enqueueJob(supabase, userId, "IDEA_GENERATE", "RESEARCH_ITEM", items[0].id);
  } else {
    // 複数選択時はtarget_idはダミー(先頭のID)とし、実体はpayloadで渡す。
    await enqueueJob(supabase, userId, "IDEA_GENERATE", "RESEARCH_ITEM_SET", items[0].id, {
      research_item_ids: items.map((i) => i.id),
    });
  }

  revalidatePath(GROWTH_OS_RESEARCH_ROUTE);
  revalidatePath(GROWTH_OS_IDEAS_ROUTE);
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

export async function createIdeaManuallyAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("タイトルは必須です");

  const idea = await createIdeaManually(supabase, userId, {
    title,
    summary: (formData.get("summary") as string) || null,
  });
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

/** Idea詳細・Dashboard共通の最終判断3択。 */
export async function approveIdeaAction(id: string) {
  await setIdeaStatus(id, "APPROVED");
}

export async function holdIdeaAction(id: string) {
  await setIdeaStatus(id, "HOLD");
}

export async function rejectIdeaAction(id: string) {
  await setIdeaStatus(id, "REJECTED");
}

// ---------------------------------------------------------------------------
// APPROVED後の任意アクション(Threads/note本格生成はフェーズ3対象。
// フェーズ1で実装済みのパイプラインへの入口をIdea詳細の副次アクションとして残す)。
// ---------------------------------------------------------------------------

export async function createThreadsFromIdeaAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "THREADS_GENERATE", "IDEA", id);
  revalidatePath(`${GROWTH_OS_IDEAS_ROUTE}/${id}`);
  redirect(`${GROWTH_OS_THREADS_ROUTE}?idea=${id}`);
}

/**
 * フェーズ3の統一エントリーポイント(セクション32)。「コンテンツを作成」1クリックで
 * Content Strategy→Threads 5案→無料noteのOutlineまでを自動連鎖させ、Outline承認だけ人間を待つ。
 */
export async function createContentFromIdeaAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "THREADS_GENERATE", "IDEA", id);
  revalidatePath(`${GROWTH_OS_IDEAS_ROUTE}/${id}`);
  redirect(`${GROWTH_OS_IDEAS_ROUTE}/${id}/content`);
}

async function createNoteArticleFromIdea(id: string, type: "FREE" | "PAID") {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  const idea = await getIdea(supabase, userId, id);
  if (!idea) throw new Error("Idea not found");

  const article = await createNoteArticle(supabase, userId, { idea_id: idea.id, type, title: idea.title });
  await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id);

  revalidatePath(`${GROWTH_OS_IDEAS_ROUTE}/${id}`);
  redirect(`${GROWTH_OS_NOTE_ROUTE}/${article.id}`);
}

export async function createNoteFreeFromIdeaAction(id: string) {
  await createNoteArticleFromIdea(id, "FREE");
}

export async function createNotePaidFromIdeaAction(id: string) {
  await createNoteArticleFromIdea(id, "PAID");
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

/** 個別Threads投稿のAI再生成(REGENERATE)。手動編集済みの投稿はガード側で弾かれる。 */
export async function regenerateThreadsPostAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  const post = await getThreadsPost(supabase, userId, id);
  if (!post) throw new Error("Threads post not found");
  if (post.manual_edited) throw new Error("手動編集済みの投稿はAI再生成できません");

  await enqueueJob(supabase, userId, "THREADS_REWRITE", "THREADS_POST", id);
  revalidatePath(`${GROWTH_OS_THREADS_ROUTE}/${id}`);
}

/** 人間による本文の直接編集(EDIT)。以降このPostはAI再生成の対象から外れる。 */
export async function manualEditThreadsPostAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const id = String(formData.get("id"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("本文は必須です");

  await saveVersion(supabase, userId, {
    target_type: "THREADS_POST",
    target_id: id,
    content: body,
    created_by: "USER",
    reason: "手動編集",
  });
  await applyManualThreadsEdit(supabase, id, body);

  revalidatePath(GROWTH_OS_THREADS_ROUTE);
  revalidatePath(`${GROWTH_OS_THREADS_ROUTE}/${id}`);
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
  const { supabase, userId } = await requireGrowthOsUser();
  const article = await getNoteArticle(supabase, userId, id);
  if (!article) throw new Error("Article not found");
  await transitionArticleStatus(supabase, article, "APPROVED");
  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
  revalidatePath(GROWTH_OS_APPROVAL_ROUTE);
}

export async function rejectArticleAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  const article = await getNoteArticle(supabase, userId, id);
  if (!article) throw new Error("Article not found");
  await transitionArticleStatus(supabase, article, "REJECTED");
  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
  revalidatePath(GROWTH_OS_APPROVAL_ROUTE);
}

export async function publishArticleAction(formData: FormData) {
  const { supabase } = await requireGrowthOsUser();
  const id = String(formData.get("id"));
  const noteUrl = parseHttpUrl(formData.get("note_url") as string | null);
  await publishNoteArticle(supabase, id, noteUrl);
  revalidatePath(GROWTH_OS_NOTE_ROUTE);
  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
}

/** Outline承認(セクション7の必須人間承認ゲート)。OUTLINE→DRAFTへ遷移し、Section本文生成を自動連鎖させる。 */
export async function approveOutlineAction(id: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  const article = await getNoteArticle(supabase, userId, id);
  if (!article) throw new Error("Article not found");

  await approveOutlineAndStartDraft(supabase, article);
  await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", id);

  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${id}`);
}

/** Section本文の手動編集(セクション21)。以降このSectionはAI再生成の対象から外れる。 */
export async function manualEditArticleSectionAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const sectionId = String(formData.get("section_id"));
  const content = String(formData.get("content") ?? "");

  const section = await getArticleSection(supabase, userId, sectionId);
  if (!section) throw new Error("Section not found");

  await saveVersion(supabase, userId, {
    target_type: "NOTE_ARTICLE",
    target_id: section.article_id,
    content,
    created_by: "USER",
    reason: `Section「${section.heading}」の手動編集`,
  });
  await applyManualSectionEdit(supabase, sectionId, content);

  const sections = await listArticleSections(supabase, userId, section.article_id);
  await updateArticleBody(supabase, section.article_id, assembleBodyMarkdown(sections));

  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${section.article_id}`);
}

/** 版の巻き戻し(セクション22)。戻す操作自体も新しい版として記録し、履歴を欠落させない。 */
export async function restoreArticleVersionAction(versionId: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  const version = await getVersion(supabase, userId, versionId);
  if (!version) throw new Error("Version not found");

  if (version.target_type === "NOTE_ARTICLE") {
    await updateArticleBody(supabase, version.target_id, version.content);
  } else {
    await applyManualThreadsEdit(supabase, version.target_id, version.content);
  }
  await saveVersion(supabase, userId, {
    target_type: version.target_type,
    target_id: version.target_id,
    content: version.content,
    created_by: "USER",
    reason: `version ${version.version} へ巻き戻し`,
  });

  if (version.target_type === "NOTE_ARTICLE") {
    revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${version.target_id}`);
  } else {
    revalidatePath(`${GROWTH_OS_THREADS_ROUTE}/${version.target_id}`);
  }
}

/** 有料note候補判定(セクション24)。無料note公開後に人間が任意で実行する。 */
export async function evaluatePaidCandidateAction(articleId: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);
  await enqueueJob(supabase, userId, "PAID_CANDIDATE_EVALUATE", "NOTE_ARTICLE", articleId);
  revalidatePath(`${GROWTH_OS_NOTE_ROUTE}/${articleId}`);
}

/** 無料note→有料note化。同じIdea/Content Strategyを引き継ぎ、STRATEGYから自動連鎖させる。 */
export async function createPaidNoteFromFreeArticleAction(freeArticleId: string) {
  const { supabase, userId } = await requireGrowthOsUser();
  await assertUnderDailyJobLimit(supabase, userId);

  const freeArticle = await getNoteArticle(supabase, userId, freeArticleId);
  if (!freeArticle) throw new Error("Article not found");
  if (!freeArticle.idea_id) throw new Error("Ideaに紐づかない記事は有料note化できません");

  const paidArticle = await createNoteArticle(supabase, userId, {
    idea_id: freeArticle.idea_id,
    strategy_id: freeArticle.strategy_id,
    type: "PAID",
    title: freeArticle.title,
  });
  await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", paidArticle.id);

  revalidatePath(GROWTH_OS_NOTE_ROUTE);
  redirect(`${GROWTH_OS_NOTE_ROUTE}/${paidArticle.id}`);
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

// ---------------------------------------------------------------------------
// Experience Library(セクション11): 架空体験防止のための本人実体験ストック
// ---------------------------------------------------------------------------

export async function createExperienceAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  if (!title || !summary) throw new Error("タイトルと内容は必須です");

  const tagsRaw = String(formData.get("tags") ?? "");
  const tags = tagsRaw
    .split(/[,、]/)
    .map((t) => t.trim())
    .filter(Boolean);

  await createExperienceLibraryItem(supabase, userId, {
    title,
    summary,
    tags,
    // 登録直後は「本人がこれから確認する」状態とし、確認が終わるまでAIには使わせない。
    confidence: "NEEDS_REVIEW",
  });
  revalidatePath(GROWTH_OS_EXPERIENCE_ROUTE);
}

/** 「これは本当」「これは間違い」の本人確認(セクション11)。VERIFIED_BY_USERのみAIが使用可能になる。 */
export async function setExperienceConfidenceAction(id: string, confidence: ExperienceConfidence) {
  const { supabase } = await requireGrowthOsUser();
  await updateExperienceConfidence(supabase, id, confidence);
  revalidatePath(GROWTH_OS_EXPERIENCE_ROUTE);
}

export async function deleteExperienceAction(id: string) {
  const { supabase } = await requireGrowthOsUser();
  await deleteExperienceLibraryItem(supabase, id);
  revalidatePath(GROWTH_OS_EXPERIENCE_ROUTE);
}

// ---------------------------------------------------------------------------
// Writing Profile / Voice Engine(セクション10)
// ---------------------------------------------------------------------------

export async function updateWritingProfileAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();

  const parseList = (key: string) =>
    String(formData.get(key) ?? "")
      .split(/[,、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  await upsertWritingProfile(supabase, userId, {
    preferred_tone: String(formData.get("preferred_tone") ?? ""),
    sentence_length: (formData.get("sentence_length") as WritingProfile["sentence_length"]) || "MEDIUM",
    humor_level: Number(formData.get("humor_level") ?? 20),
    directness: Number(formData.get("directness") ?? 60),
    emotional_level: Number(formData.get("emotional_level") ?? 60),
    technical_level: Number(formData.get("technical_level") ?? 30),
    emoji_level: Number(formData.get("emoji_level") ?? 0),
    line_break_style: (formData.get("line_break_style") as WritingProfile["line_break_style"]) || "MODERATE",
    ng_phrases: parseList("ng_phrases"),
    preferred_phrases: parseList("preferred_phrases"),
  });

  revalidatePath(GROWTH_OS_SETTINGS_ROUTE);
}

/** 承認済みのThreads/note本文を「自分の声」のサンプルとしてマークする(セクション10)。 */
export async function approveWritingSampleAction(formData: FormData) {
  const { supabase, userId } = await requireGrowthOsUser();
  const sourceType = String(formData.get("source_type")) as "THREADS_POST" | "NOTE_ARTICLE";
  const sourceId = String(formData.get("source_id"));
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  if (!excerpt) throw new Error("excerptは必須です");

  await addWritingSample(supabase, userId, { source_type: sourceType, source_id: sourceId, excerpt });
  revalidatePath(GROWTH_OS_SETTINGS_ROUTE);
}
