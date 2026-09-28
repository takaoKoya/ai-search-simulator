import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentIdea, ContentStrategy, ExperienceLibraryItem, ResearchItem, WritingProfile } from "@/lib/growth-os/types";
import type { ExperienceEntryInput, SourceEntryInput, StrategyContext, WritingProfileContext } from "@/lib/growth-os/ai/types";
import { getAIProvider } from "@/lib/growth-os/ai/anthropicProvider";
import { getContentStrategyByIdea, createContentStrategy } from "@/lib/growth-os/db/contentStrategies";
import { getWritingProfile } from "@/lib/growth-os/db/writingProfile";
import { listVerifiedExperienceLibrary } from "@/lib/growth-os/db/experienceLibrary";
import { listIdeaEvidence } from "@/lib/growth-os/db/ideaSources";
import { insertAiReview } from "@/lib/growth-os/db/reviews";
import type { JobUsage } from "@/lib/growth-os/db/jobs";
import type { AIUsage } from "@/lib/growth-os/ai/types";

export function toJobUsage(usage: AIUsage): JobUsage {
  return {
    model: usage.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    estimated_cost: usage.estimated_cost,
  };
}

export function toStrategyContext(strategy: ContentStrategy): StrategyContext {
  return {
    targetReader: strategy.target_reader,
    mainMessage: strategy.main_message,
    uniqueAngle: strategy.unique_angle,
    desiredAction: strategy.desired_action,
    threadsRole: strategy.threads_role,
    freeNoteRole: strategy.free_note_role,
    paidNoteRole: strategy.paid_note_role,
    ctaStrategy: strategy.cta_strategy,
  };
}

export function toWritingProfileContext(profile: WritingProfile | null): WritingProfileContext | null {
  if (!profile) return null;
  return {
    preferredTone: profile.preferred_tone,
    sentenceLength: profile.sentence_length,
    humorLevel: profile.humor_level,
    directness: profile.directness,
    emotionalLevel: profile.emotional_level,
    technicalLevel: profile.technical_level,
    emojiLevel: profile.emoji_level,
    lineBreakStyle: profile.line_break_style,
    ngPhrases: profile.ng_phrases,
    preferredPhrases: profile.preferred_phrases,
  };
}

export function toExperienceInputs(items: ExperienceLibraryItem[]): ExperienceEntryInput[] {
  return items.map((e) => ({ id: e.id, title: e.title, summary: e.summary, tags: e.tags }));
}

export function toSourceInputs(researchItems: ResearchItem[]): SourceEntryInput[] {
  return researchItems.map((r) => ({ id: r.id, title: r.title, summary: r.summary ?? r.surface_problem }));
}

export interface IdeaAiContext {
  strategy: ContentStrategy;
  strategyContext: StrategyContext;
  writingProfile: WritingProfileContext | null;
  experiences: ExperienceEntryInput[];
  sources: SourceEntryInput[];
}

/**
 * Ideaに紐づくContent Strategy/Writing Profile/Experience Library/Sourceを1回でまとめて取得する。
 * Content Strategyが未生成なら、ここでAI生成して保存する(Threads/note どちらが先に呼んでも
 * 2重生成しないよう、常に getContentStrategyByIdea で既存を確認してから生成する)。
 */
export async function loadIdeaAiContext(
  supabase: SupabaseClient,
  userId: string,
  idea: ContentIdea
): Promise<IdeaAiContext> {
  let strategy = await getContentStrategyByIdea(supabase, userId, idea.id);

  if (!strategy) {
    const evidence = await listIdeaEvidence(supabase, userId, idea.id);
    const generated = await getAIProvider().generateStrategy({
      ideaTitle: idea.title,
      hook: idea.hook,
      angle: idea.angle,
      targetPersona: idea.target_persona,
      coreProblem: idea.core_problem,
      harmTypes: idea.harm_types,
      recommendedFreeOrPaid: idea.recommended_free_or_paid,
      evidenceSummaries: evidence.map((e) => e.researchItem.summary ?? e.researchItem.title),
    });

    strategy = await createContentStrategy(supabase, userId, idea.id, generated.data);
    await insertAiReview(supabase, userId, {
      target_type: "IDEA",
      target_id: idea.id,
      agent_type: "STRATEGY_EDITOR",
      feedback: `Content Strategyを生成しました: ${generated.data.main_message}`,
      raw_response: generated.data,
    });
  }

  const [profile, experiences, evidence] = await Promise.all([
    getWritingProfile(supabase, userId),
    listVerifiedExperienceLibrary(supabase, userId),
    listIdeaEvidence(supabase, userId, idea.id),
  ]);

  return {
    strategy,
    strategyContext: toStrategyContext(strategy),
    writingProfile: toWritingProfileContext(profile),
    experiences: toExperienceInputs(experiences),
    sources: toSourceInputs(evidence.map((e) => e.researchItem)),
  };
}
