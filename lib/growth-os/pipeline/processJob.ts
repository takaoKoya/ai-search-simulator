import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiJob, HarmType, IdeaScoreReasonEntry } from "@/lib/growth-os/types";
import { completeJob, enqueueJob, failJob, type JobUsage } from "@/lib/growth-os/db/jobs";
import { insertAiReview } from "@/lib/growth-os/db/reviews";
import { getAIProvider } from "@/lib/growth-os/ai/anthropicProvider";
import { computeContentHash } from "@/lib/growth-os/hash";
import { updateResearchAnalysis, markResearchPromoted } from "@/lib/growth-os/db/research";
import { listIdeaEvidence, linkIdeaSources } from "@/lib/growth-os/db/ideaSources";
import { insertGeneratedIdeas, listIdeas, applyIdeaScoring, type IdeaScoringPatch } from "@/lib/growth-os/db/ideas";
import {
  computeTotalScore,
  defaultStatusForScore,
  scoreReasonToColumns,
  validateScoreReason,
} from "@/lib/growth-os/scoring";
import { computeConfidence, computeFreshnessScore, judgeIdea, CONFIDENCE_JUDGMENT_LABELS } from "@/lib/growth-os/confidence";
import { findMostSimilarIdea, isDuplicate, type IdeaSimilarityCandidate } from "@/lib/growth-os/dedupe";
import { generateThreadsPatterns, analyzeThreadsTone } from "@/lib/growth-os/agents/threadsGenerator";
import { suggestProduct } from "@/lib/growth-os/agents/productSuggester";
import { adviseOnAnalytics } from "@/lib/growth-os/agents/analyticsAdvisor";
import { advanceArticlePipeline } from "@/lib/growth-os/pipeline/articlePipeline";
import { aggregateByTheme, listContentMetrics } from "@/lib/growth-os/db/metrics";
import { SETTINGS_KEYS, upsertSetting } from "@/lib/growth-os/db/settings";
import type { AIUsage } from "@/lib/growth-os/ai/types";

interface DispatchResult {
  result: unknown;
  usage?: JobUsage;
}

function toJobUsage(usage: AIUsage): JobUsage {
  return {
    model: usage.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    estimated_cost: usage.estimated_cost,
  };
}

/** ジョブキューから取り出した1件を処理する。失敗時はfailJobでリトライ枠を消費する。 */
export async function processJob(supabase: SupabaseClient, job: AiJob): Promise<void> {
  try {
    const { result, usage } = await dispatch(supabase, job);
    await completeJob(supabase, job.id, result ?? null, usage);
  } catch (err) {
    await failJob(supabase, job, err instanceof Error ? err.message : String(err));
  }
}

async function dispatch(supabase: SupabaseClient, job: AiJob): Promise<DispatchResult> {
  switch (job.job_type) {
    case "RESEARCH_CLASSIFY":
      return handleResearchClassify(supabase, job);
    case "IDEA_GENERATE":
      return handleIdeaGenerate(supabase, job);
    case "IDEA_SCORE":
      return handleIdeaScore(supabase, job);
    case "THREADS_GENERATE":
      return { result: await handleThreadsGenerate(supabase, job) };
    case "THREADS_TONE_ANALYZE":
      return { result: await handleThreadsToneAnalyze(supabase, job) };
    case "ARTICLE_ADVANCE":
      return { result: await handleArticleAdvance(supabase, job) };
    case "PRODUCT_SUGGEST":
      return { result: await handleProductSuggest(supabase, job) };
    case "ANALYTICS_ADVISE":
      return { result: await handleAnalyticsAdvise(supabase, job) };
    default:
      throw new Error(`未知のjob_type: ${job.job_type}`);
  }
}

// ---------------------------------------------------------------------------
// Research: AI分析(HARM分類 + 表面/深層の悩み + 感情トリガー)
// ---------------------------------------------------------------------------
async function handleResearchClassify(supabase: SupabaseClient, job: AiJob): Promise<DispatchResult> {
  const { data: item, error } = await supabase
    .from("gos_research_items")
    .select("*")
    .eq("id", job.target_id)
    .single();
  if (error) throw error;

  // 内容に変更がなければ再解析しない(同一ハッシュ・解析済みならスキップしてコストを節約)。
  const currentHash = computeContentHash(item.title, item.raw_text, item.summary);
  if (item.content_hash === currentHash && item.analysis_version > 0) {
    return { result: { skipped: true, reason: "内容に変更がないため再解析をスキップしました" } };
  }

  const analysis = await getAIProvider().analyzeResearch({
    title: item.title,
    summary: item.summary,
    rawText: item.raw_text,
    sourceName: item.source_name,
    keyword: item.keyword,
  });

  await updateResearchAnalysis(supabase, job.target_id, {
    harm_types: analysis.data.harm_types as HarmType[],
    surface_problem: analysis.data.surface_problem,
    deep_problem: analysis.data.deep_problem,
    emotional_trigger: analysis.data.emotional_trigger,
    trend_score: analysis.data.trend_score,
    pain_score: analysis.data.pain_score,
    content_hash: currentHash,
    analysis_version: item.analysis_version + 1,
  });

  await insertAiReview(supabase, job.user_id, {
    target_type: "RESEARCH_ITEM",
    target_id: job.target_id,
    agent_type: "RESEARCH_CLASSIFIER",
    feedback: analysis.data.reasoning,
    raw_response: analysis.data,
  });

  return { result: analysis.data, usage: toJobUsage(analysis.usage) };
}

// ---------------------------------------------------------------------------
// Idea生成: Research(単一/複数)からコンテンツテーマ候補を作成し、
// 生成直後にIDEA_SCOREジョブも自動で積む(「生成→採点」を1操作で完結させる)。
// ---------------------------------------------------------------------------
async function handleIdeaGenerate(supabase: SupabaseClient, job: AiJob): Promise<DispatchResult> {
  const researchItemIds =
    job.target_type === "RESEARCH_ITEM_SET" ? (job.payload.research_item_ids as string[]) : [job.target_id];

  const { data: researchItems, error } = await supabase
    .from("gos_research_items")
    .select("*")
    .in("id", researchItemIds);
  if (error) throw error;
  if (!researchItems || researchItems.length === 0) throw new Error("Research item(s) not found");

  const generation = await getAIProvider().generateIdeas({
    sources: researchItems.map((r) => ({
      title: r.title,
      summary: r.summary,
      surfaceProblem: r.surface_problem,
      deepProblem: r.deep_problem,
      emotionalTrigger: r.emotional_trigger,
      harmTypes: r.harm_types,
    })),
  });

  const primaryResearchItemId = researchItems[0].id;
  const createdIdeas = await insertGeneratedIdeas(supabase, job.user_id, generation.data, primaryResearchItemId);

  for (const idea of createdIdeas) {
    await linkIdeaSources(
      supabase,
      job.user_id,
      idea.id,
      researchItems.map((r) => ({ research_item_id: r.id, evidence: r.summary ?? r.title }))
    );

    await insertAiReview(supabase, job.user_id, {
      target_type: "IDEA",
      target_id: idea.id,
      agent_type: "IDEA_GENERATOR",
      feedback: `${researchItems.length}件のResearchから生成`,
      raw_response: idea,
    });

    await enqueueJob(supabase, job.user_id, "IDEA_SCORE", "IDEA", idea.id);
  }

  await markResearchPromoted(
    supabase,
    researchItems.map((r) => r.id)
  );

  return {
    result: { created_idea_ids: createdIdeas.map((i) => i.id) },
    usage: toJobUsage(generation.usage),
  };
}

// ---------------------------------------------------------------------------
// Idea採点: 9軸スコア + Confidence(根拠の強さ) + 重複検出
// ---------------------------------------------------------------------------
async function handleIdeaScore(supabase: SupabaseClient, job: AiJob): Promise<DispatchResult> {
  const { data: idea, error } = await supabase.from("gos_content_ideas").select("*").eq("id", job.target_id).single();
  if (error) throw error;

  const evidence = await listIdeaEvidence(supabase, job.user_id, idea.id);
  const evidenceSummaries = evidence.map(
    (e) => `${e.researchItem.title}: ${e.researchItem.summary ?? e.researchItem.surface_problem ?? ""}`
  );

  const scored = await getAIProvider().scoreIdea({
    title: idea.title,
    hook: idea.hook,
    angle: idea.angle,
    targetPersona: idea.target_persona,
    coreProblem: idea.core_problem,
    evidenceSummaries,
  });

  const entries: IdeaScoreReasonEntry[] = scored.data.scores;
  const validationErrors = validateScoreReason(entries);
  if (validationErrors.length > 0) {
    throw new Error(`Idea Scorerの出力が不正です: ${validationErrors.join(" / ")}`);
  }

  const totalScore = computeTotalScore(entries);
  const evidenceCount = evidence.length;
  const sourceCount = new Set(evidence.map((e) => e.researchItem.source_name)).size;
  const freshnessScore = computeFreshnessScore(evidence.map((e) => new Date(e.researchItem.collected_at)));
  const confidenceScore = computeConfidence({
    evidenceCount,
    sourceCount,
    freshnessScore,
    aiSelfAssessedConfidence: scored.data.confidence_self_assessment,
  });

  const existingIdeas = await listIdeas(supabase, job.user_id);
  const candidate: IdeaSimilarityCandidate = {
    id: idea.id,
    title: idea.title,
    hook: idea.hook,
    coreProblem: idea.core_problem,
    targetPersona: idea.target_persona,
  };
  const others: IdeaSimilarityCandidate[] = existingIdeas
    .filter((i) => i.id !== idea.id)
    .map((i) => ({ id: i.id, title: i.title, hook: i.hook, coreProblem: i.core_problem, targetPersona: i.target_persona }));
  const match = findMostSimilarIdea(candidate, others);

  // 人間が既にAPPROVE/REJECTしたIdeaを再採点しても、その決定は上書きしない。
  const status =
    idea.status === "APPROVED" || idea.status === "REJECTED" ? idea.status : defaultStatusForScore(totalScore);

  const patch: IdeaScoringPatch = {
    ...(scoreReasonToColumns(entries) as Omit<IdeaScoringPatch, "score_reason" | "confidence_score" | "evidence_count" | "source_count" | "freshness_score" | "duplicate_score" | "most_similar_idea_id" | "status">),
    score_reason: entries,
    confidence_score: confidenceScore,
    evidence_count: evidenceCount,
    source_count: sourceCount,
    freshness_score: freshnessScore,
    duplicate_score: match?.score ?? null,
    most_similar_idea_id: match && isDuplicate(match.score) ? match.idea.id : null,
    status,
  };

  const updated = await applyIdeaScoring(supabase, idea.id, patch);

  const judgment = judgeIdea(totalScore, confidenceScore);
  await insertAiReview(supabase, job.user_id, {
    target_type: "IDEA",
    target_id: idea.id,
    agent_type: "IDEA_SCORER",
    score: totalScore,
    feedback: `信頼度${confidenceScore}%(${CONFIDENCE_JUDGMENT_LABELS[judgment]})。根拠件数${evidenceCount}件、出典${sourceCount}種類。`,
    raw_response: entries,
  });

  return { result: updated, usage: toJobUsage(scored.usage) };
}

// ---------------------------------------------------------------------------
// 以下、フェーズ1のThreads/note/Products/Analyticsは本フェーズでは変更しない。
// ---------------------------------------------------------------------------

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
