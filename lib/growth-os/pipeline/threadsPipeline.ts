import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiJob, ThreadsPatternType, ThreadsPost } from "@/lib/growth-os/types";
import { getAIProvider } from "@/lib/growth-os/ai/anthropicProvider";
import { getIdea } from "@/lib/growth-os/db/ideas";
import {
  createThreadsPostFull,
  applyThreadsScore,
  applyThreadsRewrite,
  getThreadsPost,
} from "@/lib/growth-os/db/threads";
import { insertAiReview } from "@/lib/growth-os/db/reviews";
import { addThreadsPostToFunnel } from "@/lib/growth-os/db/contentFunnels";
import { createNoteArticle, listArticlesByIdea } from "@/lib/growth-os/db/articles";
import { enqueueJob } from "@/lib/growth-os/db/jobs";
import { checkExperienceGuard, sanitizeExperienceIds } from "@/lib/growth-os/experienceGuard";
import { computeThreadsScoreColumns, summarizeFailingCriteria } from "@/lib/growth-os/threadsScoring";
import { canRewriteThreadsPost } from "@/lib/growth-os/manualEditGuard";
import { meetsThreadsQualityBar } from "@/lib/growth-os/types";
import { loadIdeaAiContext, toJobUsage } from "@/lib/growth-os/pipeline/context";
import type { JobUsage } from "@/lib/growth-os/db/jobs";

interface RunUsage {
  usages: JobUsage[];
}

function mergeUsage(acc: RunUsage, usage: JobUsage) {
  acc.usages.push(usage);
}

function totalCost(acc: RunUsage): JobUsage | undefined {
  if (acc.usages.length === 0) return undefined;
  return {
    model: acc.usages[acc.usages.length - 1].model,
    input_tokens: acc.usages.reduce((s, u) => s + u.input_tokens, 0),
    output_tokens: acc.usages.reduce((s, u) => s + u.output_tokens, 0),
    estimated_cost: acc.usages.reduce((s, u) => s + u.estimated_cost, 0),
  };
}

/** Threads品質評価→(基準未達なら最大2回まで)リライト→再評価、を1件分行う。 */
export async function scoreAndRewriteIfNeeded(
  supabase: SupabaseClient,
  userId: string,
  post: ThreadsPost,
  ctx: Awaited<ReturnType<typeof loadIdeaAiContext>>,
  usageAcc: RunUsage
): Promise<ThreadsPost> {
  let current = post;

  for (let attempt = 0; attempt <= 2; attempt++) {
    const scored = await getAIProvider().scoreThreads({ body: current.body, patternType: current.pattern_type });
    mergeUsage(usageAcc, toJobUsage(scored.usage));
    const columns = computeThreadsScoreColumns(scored.data);
    const meets = meetsThreadsQualityBar(columns);

    current = await applyThreadsScore(supabase, current.id, columns, meets);
    await insertAiReview(supabase, userId, {
      target_type: "THREADS_POST",
      target_id: current.id,
      agent_type: "THREADS_TONE_ANALYZER",
      score: columns.overall_score,
      feedback: summarizeFailingCriteria(columns),
      raw_response: scored.data,
    });

    if (meets || !canRewriteThreadsPost(current.manual_edited, current.rewrite_count)) break;

    const rewritten = await getAIProvider().rewriteThreads({
      body: current.body,
      patternType: current.pattern_type,
      scoreFeedback: summarizeFailingCriteria(columns),
      experiences: ctx.experiences,
      writingProfile: ctx.writingProfile,
    });
    mergeUsage(usageAcc, toJobUsage(rewritten.usage));

    const guard = checkExperienceGuard({
      text: rewritten.data.body,
      experienceIdsUsed: rewritten.data.experience_ids_used,
      availableExperienceIds: ctx.experiences.map((e) => e.id),
    });
    const safeIds = sanitizeExperienceIds(rewritten.data.experience_ids_used, ctx.experiences.map((e) => e.id));
    if (!guard.ok) {
      await insertAiReview(supabase, userId, {
        target_type: "THREADS_POST",
        target_id: current.id,
        agent_type: "AI_SMELL_DETECTOR",
        verdict: "NEEDS_REVISION",
        feedback: `体験捏造ガード違反: ${guard.violations.map((v) => v.detail).join(" / ")}`,
      });
    }

    current = await applyThreadsRewrite(supabase, current, rewritten.data.body, safeIds);
  }

  return current;
}

export async function handleThreadsGenerate(supabase: SupabaseClient, job: AiJob) {
  const idea = await getIdea(supabase, job.user_id, job.target_id);
  if (!idea) throw new Error("Idea not found");

  const usageAcc: RunUsage = { usages: [] };
  const ctx = await loadIdeaAiContext(supabase, job.user_id, idea);

  const generated = await getAIProvider().generateThreads({
    ideaTitle: idea.title,
    strategy: ctx.strategyContext,
    experiences: ctx.experiences,
    writingProfile: ctx.writingProfile,
  });
  mergeUsage(usageAcc, toJobUsage(generated.usage));

  const created: ThreadsPost[] = [];
  for (const draft of generated.data) {
    const guard = checkExperienceGuard({
      text: draft.body,
      experienceIdsUsed: draft.experience_ids_used,
      availableExperienceIds: ctx.experiences.map((e) => e.id),
    });
    const safeIds = sanitizeExperienceIds(draft.experience_ids_used, ctx.experiences.map((e) => e.id));

    const post = await createThreadsPostFull(supabase, job.user_id, {
      idea_id: idea.id,
      strategy_id: ctx.strategy.id,
      pattern_type: draft.pattern_type as ThreadsPatternType,
      body: draft.body,
      experience_ids: safeIds,
    });

    await insertAiReview(supabase, job.user_id, {
      target_type: "THREADS_POST",
      target_id: post.id,
      agent_type: "THREADS_GENERATOR",
      feedback: guard.ok
        ? `${draft.pattern_type}パターンを生成しました`
        : `体験捏造ガード違反を検出: ${guard.violations.map((v) => v.detail).join(" / ")}`,
      raw_response: draft,
    });

    await addThreadsPostToFunnel(supabase, job.user_id, idea.id, post.id);
    created.push(post);
  }

  const scored: ThreadsPost[] = [];
  for (const post of created) {
    scored.push(await scoreAndRewriteIfNeeded(supabase, job.user_id, post, ctx, usageAcc));
  }

  // Threads生成完了に続けて無料noteの企画(Content Strategy→Outline)まで自動で進める(セクション32のUX方針:
  // 「コンテンツを作成」1クリックの後は、Outline承認まで人間の操作を要求しない)。
  const existingFreeArticles = await listArticlesByIdea(supabase, job.user_id, idea.id);
  const hasFreeArticle = existingFreeArticles.some((a) => a.type === "FREE" && a.status !== "REJECTED");
  if (!hasFreeArticle) {
    const article = await createNoteArticle(supabase, job.user_id, {
      idea_id: idea.id,
      strategy_id: ctx.strategy.id,
      type: "FREE",
      title: idea.title,
    });
    await enqueueJob(supabase, job.user_id, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id);
  }

  return { result: { created_count: scored.length }, usage: totalCost(usageAcc) };
}

export async function handleThreadsRewrite(supabase: SupabaseClient, job: AiJob) {
  const post = await getThreadsPost(supabase, job.user_id, job.target_id);
  if (!post) throw new Error("Threads post not found");
  if (!canRewriteThreadsPost(post.manual_edited, post.rewrite_count)) {
    return {
      result: {
        skipped: true,
        reason: post.manual_edited ? "手動編集済みのためAIリライトの対象外です" : "リライト上限(2回)に達しています",
      },
    };
  }

  const idea = await getIdea(supabase, job.user_id, post.idea_id);
  if (!idea) throw new Error("Idea not found");

  const usageAcc: RunUsage = { usages: [] };
  const ctx = await loadIdeaAiContext(supabase, job.user_id, idea);

  const feedback =
    (job.payload?.feedback as string | undefined) ??
    (post.score_reason.length > 0
      ? post.score_reason.map((r) => `[${r.criterion}] ${r.reason}`).join("\n")
      : "全体的にもう一段質を上げてください。");

  const rewritten = await getAIProvider().rewriteThreads({
    body: post.body,
    patternType: post.pattern_type,
    scoreFeedback: feedback,
    experiences: ctx.experiences,
    writingProfile: ctx.writingProfile,
  });
  mergeUsage(usageAcc, toJobUsage(rewritten.usage));

  const safeIds = sanitizeExperienceIds(rewritten.data.experience_ids_used, ctx.experiences.map((e) => e.id));
  const updated = await applyThreadsRewrite(supabase, post, rewritten.data.body, safeIds);

  const rescored = await scoreAndRewriteIfNeeded(supabase, job.user_id, updated, ctx, usageAcc);

  return { result: rescored, usage: totalCost(usageAcc) };
}

/** @deprecated 新フローではhandleThreadsGenerate/handleThreadsRewrite内で評価まで完結する。
 * 過去に積まれたTHREADS_TONE_ANALYZEジョブとの互換用に、再評価のみを行うエントリを残す。 */
export async function handleThreadsToneAnalyze(supabase: SupabaseClient, job: AiJob) {
  const post = await getThreadsPost(supabase, job.user_id, job.target_id);
  if (!post) throw new Error("Threads post not found");

  const idea = await getIdea(supabase, job.user_id, post.idea_id);
  if (!idea) throw new Error("Idea not found");

  const usageAcc: RunUsage = { usages: [] };
  const ctx = await loadIdeaAiContext(supabase, job.user_id, idea);
  const rescored = await scoreAndRewriteIfNeeded(supabase, job.user_id, post, ctx, usageAcc);

  return { result: rescored, usage: totalCost(usageAcc) };
}
