import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "@/lib/growth-os/ai/anthropicProvider";
import { getIdea } from "@/lib/growth-os/db/ideas";
import {
  applyOutline,
  approveOutline as dbApproveOutline,
  applyReviewResult,
  incrementRevisionCount,
  transitionArticleStatus,
  updateArticleBody,
} from "@/lib/growth-os/db/articles";
import {
  createSectionsFromOutline,
  listArticleSections,
  applySectionDraft,
  assembleBodyMarkdown,
} from "@/lib/growth-os/db/articleSections";
import { insertFactClaims } from "@/lib/growth-os/db/factClaims";
import { saveVersion } from "@/lib/growth-os/db/articleVersions";
import { setFunnelFreeNote, setFunnelPaidNote } from "@/lib/growth-os/db/contentFunnels";
import { insertAiReview } from "@/lib/growth-os/db/reviews";
import { enqueueJob } from "@/lib/growth-os/db/jobs";
import { loadIdeaAiContext, toJobUsage } from "@/lib/growth-os/pipeline/context";
import { checkExperienceGuard, sanitizeExperienceIds } from "@/lib/growth-os/experienceGuard";
import { detectAiSmell } from "@/lib/growth-os/aiSmell";
import { enforceFactClaimClassification, resolveSourceHint, hasUnverifiedClaims } from "@/lib/growth-os/factCheck";
import { guardCtaForArticleType } from "@/lib/growth-os/ctaGuard";
import type { AiJob, ArticleSection, NoteArticle } from "@/lib/growth-os/types";
import type { JobUsage } from "@/lib/growth-os/db/jobs";
import type { AIUsage } from "@/lib/growth-os/ai/types";

const REVIEW_QUALITY_BAR = 80;
const CREDIBILITY_HUMANITY_WARNING_BAR = 70;
const MAX_AUTO_REVISIONS = 3;

interface UsageAccumulator {
  usages: JobUsage[];
}

function record(acc: UsageAccumulator, usage: AIUsage) {
  acc.usages.push(toJobUsage(usage));
}

function summarizeUsage(acc: UsageAccumulator): JobUsage | undefined {
  if (acc.usages.length === 0) return undefined;
  return {
    model: acc.usages[acc.usages.length - 1].model,
    input_tokens: acc.usages.reduce((s, u) => s + u.input_tokens, 0),
    output_tokens: acc.usages.reduce((s, u) => s + u.output_tokens, 0),
    estimated_cost: acc.usages.reduce((s, u) => s + u.estimated_cost, 0),
  };
}

/**
 * 統一Content Status(STRATEGY→OUTLINE→DRAFT→AI_REVIEW→FACT_CHECK→WAITING_APPROVAL)を
 * article.status を主軸に進める状態機械。OUTLINE到達後は人間の承認(approveOutlineAction)を
 * 待って止まり、それ以外は「生成→次のジョブを自分で積む」形で自動連鎖する。
 */
export async function advanceArticlePipeline(
  supabase: SupabaseClient,
  job: AiJob,
  article: NoteArticle
): Promise<{ result: unknown; usage?: JobUsage }> {
  const userId = job.user_id;
  const usageAcc: UsageAccumulator = { usages: [] };

  switch (article.status) {
    case "STRATEGY": {
      if (!article.idea_id) throw new Error("Ideaに紐づかない記事はフェーズ3の自動生成の対象外です");
      const idea = await getIdea(supabase, userId, article.idea_id);
      if (!idea) throw new Error("Idea not found");

      const ctx = await loadIdeaAiContext(supabase, userId, idea);
      const noteRole = article.type === "PAID" ? ctx.strategy.paid_note_role ?? ctx.strategy.free_note_role : ctx.strategy.free_note_role;

      const outline = await getAIProvider().generateOutline({
        ideaTitle: idea.title,
        coreProblem: idea.core_problem,
        strategy: ctx.strategyContext,
        articleType: article.type,
        noteRole,
      });
      record(usageAcc, outline.usage);

      const recommended = outline.data.title_candidates[outline.data.recommended_title_index];
      const guardedCtaType = guardCtaForArticleType(article.type, outline.data.cta.type);

      const updated = await applyOutline(supabase, article, {
        title: recommended.title,
        title_candidates: outline.data.title_candidates,
        lead: outline.data.lead,
        reader_problem: outline.data.reader_problem,
        promise: outline.data.promise,
        cta_type: guardedCtaType,
        cta_text: outline.data.cta.text,
      });

      await createSectionsFromOutline(supabase, userId, article.id, outline.data.sections);

      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "TITLE_GENERATOR",
        feedback: `推奨タイトル: ${recommended.title}(${outline.data.title_candidates.length}案中)`,
        raw_response: outline.data.title_candidates,
      });
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "OUTLINE_GENERATOR",
        feedback: `${outline.data.sections.length}セクション構成のOutlineを生成しました。人間の承認待ちです。`,
        raw_response: outline.data,
      });

      // OUTLINEで停止。次の本文生成は人間がapproveOutlineActionを呼ぶまで走らない。
      return { result: { outline: updated }, usage: summarizeUsage(usageAcc) };
    }

    case "DRAFT": {
      if (!article.idea_id) throw new Error("Ideaに紐づかない記事はフェーズ3の自動生成の対象外です");
      const idea = await getIdea(supabase, userId, article.idea_id);
      if (!idea) throw new Error("Idea not found");

      const ctx = await loadIdeaAiContext(supabase, userId, idea);
      const sections = await listArticleSections(supabase, userId, article.id);

      const revisionInstructions = job.payload?.revision_instructions as string | undefined;
      let summarySoFar = "";

      for (const section of sections) {
        if (section.manual_edited) {
          summarySoFar += `\n${section.heading}: (人間による編集済み。要約省略)`;
          continue;
        }
        if (section.content && !revisionInstructions) {
          summarySoFar += `\n${section.heading}: ${section.content.slice(0, 120)}`;
          continue;
        }

        const draft = await getAIProvider().draftSection({
          articleTitle: article.title,
          strategy: ctx.strategyContext,
          articleType: article.type,
          heading: section.heading,
          purpose: section.purpose,
          keyPoints: section.key_points,
          evidenceRequired: section.evidence_required,
          experienceRequired: section.experience_required,
          precedingSectionsSummary: summarySoFar || null,
          availableSources: ctx.sources,
          availableExperiences: ctx.experiences,
          writingProfile: ctx.writingProfile,
          revisionInstructions: revisionInstructions ?? null,
        });
        record(usageAcc, draft.usage);

        const guard = checkExperienceGuard({
          text: draft.data.content,
          experienceIdsUsed: draft.data.experience_ids_used,
          availableExperienceIds: ctx.experiences.map((e) => e.id),
        });
        const safeExperienceIds = sanitizeExperienceIds(draft.data.experience_ids_used, ctx.experiences.map((e) => e.id));
        const safeSourceIds = draft.data.source_ids_used.filter((id) => ctx.sources.some((s) => s.id === id));

        await applySectionDraft(supabase, section.id, {
          content: draft.data.content,
          source_ids: safeSourceIds,
          experience_ids: safeExperienceIds,
        });

        await insertAiReview(supabase, userId, {
          target_type: "NOTE_ARTICLE",
          target_id: article.id,
          agent_type: "SECTION_WRITER",
          feedback: guard.ok
            ? `Section「${section.heading}」を執筆しました${draft.data.needs_user_input ? "(要: 本人による追記)" : ""}`
            : `体験捏造ガード違反を検出: ${guard.violations.map((v) => v.detail).join(" / ")}`,
          raw_response: draft.data,
        });

        summarySoFar += `\n${section.heading}: ${draft.data.content.slice(0, 120)}`;
      }

      const refreshedSections = await listArticleSections(supabase, userId, article.id);
      const bodyMarkdown = assembleBodyMarkdown(refreshedSections);
      await updateArticleBody(supabase, article.id, bodyMarkdown);
      await saveVersion(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        content: bodyMarkdown,
        created_by: "AI",
        reason: revisionInstructions ? "AI_REVIEWでの修正指示を反映" : "初回ドラフト生成",
      });

      const updated = await transitionArticleStatus(supabase, article, "AI_REVIEW");
      return { result: { article: updated }, usage: summarizeUsage(usageAcc) };
    }

    case "AI_REVIEW": {
      if (!article.idea_id) throw new Error("Ideaに紐づかない記事はフェーズ3の自動生成の対象外です");
      const idea = await getIdea(supabase, userId, article.idea_id);
      if (!idea) throw new Error("Idea not found");
      const ctx = await loadIdeaAiContext(supabase, userId, idea);

      const review = await getAIProvider().reviewArticle({
        title: article.title,
        fullBody: article.body_markdown,
        strategy: ctx.strategyContext,
      });
      record(usageAcc, review.usage);

      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "STRATEGY_EDITOR",
        verdict: review.data.strategy_alignment.verdict,
        feedback: review.data.strategy_alignment.feedback,
      });
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "READER_50S_AGENT",
        verdict: review.data.reader_reaction.verdict,
        feedback: review.data.reader_reaction.feedback,
      });
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "CHIEF_EDITOR_AGENT",
        verdict: review.data.critical_editor.verdict,
        feedback: `${review.data.critical_editor.feedback}\nAI臭の指摘: ${review.data.critical_editor.ai_smell_notes.join(" / ") || "なし"}\n修正指示: ${review.data.critical_editor.revision_instructions}`,
        raw_response: review.data.scores,
      });
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "HUMANITY_CHECKER",
        score: review.data.humanity_assessment.score,
        feedback: review.data.humanity_assessment.reason,
      });

      const ruleBasedSmell = detectAiSmell(article.body_markdown);
      if (ruleBasedSmell.length > 0) {
        await insertAiReview(supabase, userId, {
          target_type: "NOTE_ARTICLE",
          target_id: article.id,
          agent_type: "AI_SMELL_DETECTOR",
          feedback: ruleBasedSmell.map((f) => `[${f.pattern}] ${f.reason} → ${f.suggested_fix}`).join("\n"),
          raw_response: ruleBasedSmell,
        });
      }

      const qualityScore = Math.round(
        review.data.scores.reduce((sum, s) => sum + s.score, 0) / review.data.scores.length
      );
      const credibility = review.data.scores.find((s) => s.criterion === "credibility")?.score ?? 100;
      const humanity = review.data.humanity_assessment.score;

      const hasFail =
        review.data.strategy_alignment.verdict === "FAIL" ||
        review.data.reader_reaction.verdict === "FAIL" ||
        review.data.critical_editor.verdict === "FAIL";
      const needsRevision =
        hasFail ||
        qualityScore < REVIEW_QUALITY_BAR ||
        credibility < CREDIBILITY_HUMANITY_WARNING_BAR ||
        humanity < CREDIBILITY_HUMANITY_WARNING_BAR;

      if (needsRevision && article.revision_count < MAX_AUTO_REVISIONS) {
        await incrementRevisionCount(supabase, article.id);
        // Section本文だけを、指摘を反映して再生成する(記事全体を書き直さない。セクション15)。
        // DRAFTへ差し戻し、次のARTICLE_ADVANCEで空欄化したSectionだけが再執筆される。
        const sections = await listArticleSections(supabase, userId, article.id);
        for (const section of sections.filter((s: ArticleSection) => !s.manual_edited)) {
          await applySectionDraft(supabase, section.id, {
            content: "",
            source_ids: section.source_ids,
            experience_ids: section.experience_ids,
          });
        }
        await transitionArticleStatus(supabase, article, "DRAFT");
        await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id, {
          revision_instructions: review.data.critical_editor.revision_instructions,
        });
        return {
          result: {
            revision: true,
            quality_score: qualityScore,
            revision_instructions: review.data.critical_editor.revision_instructions,
          },
          usage: summarizeUsage(usageAcc),
        };
      }

      const belowThreshold = needsRevision; // 修正上限到達でも公開ブロックはせず、警告フラグを立てて人間へ委ねる。
      const updated = await applyReviewResult(supabase, article, "FACT_CHECK", {
        quality_score: qualityScore,
        quality_below_threshold: belowThreshold,
      });

      return { result: { article: updated, quality_score: qualityScore }, usage: summarizeUsage(usageAcc) };
    }

    case "FACT_CHECK": {
      if (!article.idea_id) throw new Error("Ideaに紐づかない記事はフェーズ3の自動生成の対象外です");
      const idea = await getIdea(supabase, userId, article.idea_id);
      if (!idea) throw new Error("Idea not found");
      const ctx = await loadIdeaAiContext(supabase, userId, idea);

      const factCheck = await getAIProvider().factCheckArticle({
        fullBody: article.body_markdown,
        availableSources: ctx.sources,
      });
      record(usageAcc, factCheck.usage);

      const enforcedClaims = factCheck.data.claims.map((claim) => {
        const enforcement = enforceFactClaimClassification({
          claim: claim.claim,
          aiClassification: claim.classification,
          sourceHintIndex: claim.source_hint_index,
        });
        return {
          article_id: article.id,
          section_id: null,
          claim: claim.claim,
          classification: enforcement.classification,
          source_id: resolveSourceHint(claim.source_hint_index, ctx.sources),
          confidence: claim.confidence,
          action_required: enforcement.classification === "UNVERIFIED",
        };
      });
      await insertFactClaims(supabase, userId, enforcedClaims);

      const unverifiedCount = enforcedClaims.filter((c) => c.classification === "UNVERIFIED").length;
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "FACT_CHECK_AGENT",
        verdict: hasUnverifiedClaims(enforcedClaims.map((c) => c.classification)) ? "NEEDS_REVISION" : "PASS",
        feedback: `事実主張${enforcedClaims.length}件を抽出。うちUNVERIFIED ${unverifiedCount}件${
          unverifiedCount > 0 ? "(公開前に人間の確認が必要です)" : ""
        }`,
        raw_response: enforcedClaims,
      });

      const salesEdit = await getAIProvider().salesEditArticle({
        title: article.title,
        fullBody: article.body_markdown,
        articleType: article.type,
        price: article.price,
        ctaStrategy: ctx.strategy.cta_strategy,
      });
      record(usageAcc, salesEdit.usage);

      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "SALES_EDITOR_AGENT",
        score: salesEdit.data.cta_score,
        feedback: `${salesEdit.data.feedback}${
          salesEdit.data.suggested_cta ? `\n提案CTA: ${salesEdit.data.suggested_cta.text}` : ""
        }`,
        raw_response: salesEdit.data,
      });

      if (article.type === "FREE") {
        await setFunnelFreeNote(supabase, userId, idea.id, article.id);
      } else {
        await setFunnelPaidNote(supabase, userId, idea.id, article.id);
      }

      const updated = await transitionArticleStatus(supabase, article, "WAITING_APPROVAL");
      return { result: { article: updated }, usage: summarizeUsage(usageAcc) };
    }

    default:
      return { result: { skipped: true, status: article.status } };
  }
}

export async function approveOutlineAndStartDraft(supabase: SupabaseClient, article: NoteArticle) {
  return dbApproveOutline(supabase, article);
}
