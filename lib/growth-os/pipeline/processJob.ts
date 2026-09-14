import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiJob } from "@/lib/growth-os/types";
import { completeJob, enqueueJob, failJob } from "@/lib/growth-os/db/jobs";
import { insertAiReview } from "@/lib/growth-os/db/reviews";
import { classifyResearchItem } from "@/lib/growth-os/agents/researchClassifier";
import { scoreIdea } from "@/lib/growth-os/agents/ideaScorer";
import { generateThreadsPatterns, analyzeThreadsTone } from "@/lib/growth-os/agents/threadsGenerator";
import { suggestProduct } from "@/lib/growth-os/agents/productSuggester";
import { adviseOnAnalytics } from "@/lib/growth-os/agents/analyticsAdvisor";
import { advanceArticlePipeline } from "@/lib/growth-os/pipeline/articlePipeline";
import { aggregateByTheme, listContentMetrics } from "@/lib/growth-os/db/metrics";
import { SETTINGS_KEYS, upsertSetting } from "@/lib/growth-os/db/settings";

/** ジョブキューから取り出した1件を処理する。失敗時はfailJobでリトライ枠を消費する。 */
export async function processJob(supabase: SupabaseClient, job: AiJob): Promise<void> {
  try {
    const result = await dispatch(supabase, job);
    await completeJob(supabase, job.id, result ?? null);
  } catch (err) {
    await failJob(supabase, job, err instanceof Error ? err.message : String(err));
  }
}

async function dispatch(supabase: SupabaseClient, job: AiJob): Promise<unknown> {
  switch (job.job_type) {
    case "RESEARCH_CLASSIFY":
      return handleResearchClassify(supabase, job);
    case "IDEA_SCORE":
      return handleIdeaScore(supabase, job);
    case "THREADS_GENERATE":
      return handleThreadsGenerate(supabase, job);
    case "THREADS_TONE_ANALYZE":
      return handleThreadsToneAnalyze(supabase, job);
    case "ARTICLE_ADVANCE":
      return handleArticleAdvance(supabase, job);
    case "PRODUCT_SUGGEST":
      return handleProductSuggest(supabase, job);
    case "ANALYTICS_ADVISE":
      return handleAnalyticsAdvise(supabase, job);
    default:
      throw new Error(`未知のjob_type: ${job.job_type}`);
  }
}

async function handleResearchClassify(supabase: SupabaseClient, job: AiJob) {
  const { data: item, error } = await supabase
    .from("gos_research_items")
    .select("*")
    .eq("id", job.target_id)
    .single();
  if (error) throw error;

  const classification = await classifyResearchItem(item);

  await supabase
    .from("gos_research_items")
    .update({
      harm_type: classification.harm_type,
      trend_score: classification.trend_score,
      pain_score: classification.pain_score,
      status: "REVIEWED",
    })
    .eq("id", job.target_id);

  await insertAiReview(supabase, job.user_id, {
    target_type: "RESEARCH_ITEM",
    target_id: job.target_id,
    agent_type: "RESEARCH_CLASSIFIER",
    feedback: classification.reasoning,
    raw_response: classification,
  });

  return classification;
}

async function handleIdeaScore(supabase: SupabaseClient, job: AiJob) {
  const { data: idea, error } = await supabase.from("gos_content_ideas").select("*").eq("id", job.target_id).single();
  if (error) throw error;

  const scored = await scoreIdea(idea);

  await supabase
    .from("gos_content_ideas")
    .update({ score_breakdown: scored.score_breakdown, total_score: scored.total_score })
    .eq("id", job.target_id);

  await insertAiReview(supabase, job.user_id, {
    target_type: "IDEA",
    target_id: job.target_id,
    agent_type: "IDEA_SCORER",
    score: scored.total_score,
    raw_response: scored.score_breakdown,
  });

  return scored;
}

async function handleThreadsGenerate(supabase: SupabaseClient, job: AiJob) {
  const { data: idea, error } = await supabase.from("gos_content_ideas").select("*").eq("id", job.target_id).single();
  if (error) throw error;

  const patterns = await generateThreadsPatterns(idea);

  const created = [];
  for (const pattern of patterns) {
    const { data: post, error: insertError } = await supabase
      .from("gos_threads_posts")
      .insert({ user_id: job.user_id, idea_id: idea.id, pattern_type: pattern.pattern_type, body: pattern.body })
      .select("*")
      .single();
    if (insertError) throw insertError;

    await insertAiReview(supabase, job.user_id, {
      target_type: "THREADS_POST",
      target_id: post.id,
      agent_type: "THREADS_GENERATOR",
      feedback: `${pattern.pattern_type}パターンを生成`,
    });

    await enqueueJob(supabase, job.user_id, "THREADS_TONE_ANALYZE", "THREADS_POST", post.id);
    created.push(post);
  }

  return { created_count: created.length };
}

async function handleThreadsToneAnalyze(supabase: SupabaseClient, job: AiJob) {
  const { data: post, error } = await supabase.from("gos_threads_posts").select("*").eq("id", job.target_id).single();
  if (error) throw error;

  const toneScores = await analyzeThreadsTone(post.body);

  await supabase
    .from("gos_threads_posts")
    .update({ tone_scores: toneScores, status: "WAITING_APPROVAL" })
    .eq("id", job.target_id);

  await insertAiReview(supabase, job.user_id, {
    target_type: "THREADS_POST",
    target_id: job.target_id,
    agent_type: "THREADS_TONE_ANALYZER",
    raw_response: toneScores,
  });

  return toneScores;
}

async function handleArticleAdvance(supabase: SupabaseClient, job: AiJob) {
  const { data: article, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("id", job.target_id)
    .single();
  if (error) throw error;

  let idea = null;
  if (article.idea_id) {
    const { data: ideaRow } = await supabase
      .from("gos_content_ideas")
      .select("title, summary")
      .eq("id", article.idea_id)
      .maybeSingle();
    idea = ideaRow;
  }

  const { result } = await advanceArticlePipeline(supabase, job, article, idea);
  return result;
}

async function handleProductSuggest(supabase: SupabaseClient, job: AiJob) {
  const { data: article, error } = await supabase
    .from("gos_note_articles")
    .select("*")
    .eq("id", job.target_id)
    .single();
  if (error) throw error;

  const pv = (job.payload?.pv as number | undefined) ?? 0;
  const likes = (job.payload?.likes as number | undefined) ?? 0;

  const suggestion = await suggestProduct({ title: article.title, body_markdown: article.body_markdown, pv, likes });

  const { data: product, error: insertError } = await supabase
    .from("gos_products")
    .insert({
      user_id: job.user_id,
      source_content_id: article.id,
      product_name: suggestion.product_name,
      recommended_price: suggestion.recommended_price,
      target: suggestion.target,
      problem: suggestion.problem,
      solution: suggestion.solution,
      product_score: suggestion.product_score,
      outline: suggestion.outline,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await insertAiReview(supabase, job.user_id, {
    target_type: "NOTE_ARTICLE",
    target_id: article.id,
    agent_type: "PRODUCT_SUGGESTER",
    score: suggestion.product_score,
    feedback: `商品提案: ${suggestion.product_name}`,
    raw_response: suggestion,
  });

  return product;
}

async function handleAnalyticsAdvise(supabase: SupabaseClient, job: AiJob) {
  const metrics = await listContentMetrics(supabase, job.user_id);
  const themes = aggregateByTheme(metrics);
  const recommendation = await adviseOnAnalytics(themes);

  await upsertSetting(supabase, job.user_id, SETTINGS_KEYS.ANALYTICS_RECOMMENDATION, {
    ...recommendation,
    generated_at: new Date().toISOString(),
  });

  return recommendation;
}
