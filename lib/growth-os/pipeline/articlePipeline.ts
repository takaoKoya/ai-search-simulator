import type { SupabaseClient } from "@supabase/supabase-js";
import { runArticleWriter } from "@/lib/growth-os/agents/articleWriter";
import { reviewArticle } from "@/lib/growth-os/agents/articleReview";
import { factCheckArticle } from "@/lib/growth-os/agents/articleFactCheck";
import { salesEditArticle } from "@/lib/growth-os/agents/articleSalesEdit";
import { insertAiReview, listAiReviewsForTarget } from "@/lib/growth-os/db/reviews";
import { enqueueJob } from "@/lib/growth-os/db/jobs";
import type { AiJob, NoteArticle } from "@/lib/growth-os/types";

const QUALITY_BAR = 80;

interface IdeaContext {
  title: string;
  summary: string | null;
}

/** 直近の修正ラウンドで出た指摘を1つの文章にまとめ、Writerの再執筆へ渡す。 */
async function buildRevisionFeedback(supabase: SupabaseClient, userId: string, article: NoteArticle) {
  const reviews = await listAiReviewsForTarget(supabase, userId, "NOTE_ARTICLE", article.id);
  const latestRound = reviews.filter((r) => r.revision_number === article.revision_count);
  if (latestRound.length === 0) return null;

  return latestRound
    .filter((r) => r.feedback)
    .map((r) => `- [${r.agent_type}] ${r.feedback}`)
    .join("\n");
}

/**
 * note記事の7Agent工程を、実行は4コールに統合して進める状態機械。
 * RESEARCH(=Research+企画編集+Writerを1コール) → READER_REVIEW(=50代読者+辛口編集長を1コール)
 * → FACT_CHECK → SALES_EDIT。品質スコア80点未満は revision_count<=3(DB制約)まで RESEARCH に差し戻す。
 */
export async function advanceArticlePipeline(
  supabase: SupabaseClient,
  job: AiJob,
  article: NoteArticle,
  idea: IdeaContext | null
): Promise<{ result: unknown }> {
  const userId = job.user_id;
  const ideaTitle = idea?.title ?? (article.title || "(無題)");
  const ideaSummary = idea?.summary ?? null;

  switch (article.current_stage) {
    case "RESEARCH": {
      const revisionFeedback =
        (job.payload?.revision_feedback as string | undefined) ??
        (article.revision_count > 0 ? await buildRevisionFeedback(supabase, userId, article) : null);

      const draft = await runArticleWriter({
        ideaTitle,
        ideaSummary,
        articleType: article.type,
        revisionFeedback,
      });

      await supabase
        .from("gos_note_articles")
        .update({
          title: draft.title,
          body_markdown: draft.body_markdown,
          current_stage: "READER_REVIEW",
          status: "DRAFT",
        })
        .eq("id", article.id);

      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "RESEARCH_AGENT",
        revision_number: article.revision_count,
        feedback: draft.research_notes,
      });
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "PLANNING_AGENT",
        revision_number: article.revision_count,
        feedback: draft.planning_notes,
      });
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "WRITER_AGENT",
        revision_number: article.revision_count,
        feedback: "ドラフトを作成しました。",
        raw_response: draft,
      });

      await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id);
      return { result: draft };
    }

    case "READER_REVIEW": {
      const review = await reviewArticle({ title: article.title, body_markdown: article.body_markdown });

      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "READER_50S_AGENT",
        revision_number: article.revision_count,
        verdict: review.reader_verdict,
        feedback: review.reader_feedback,
      });
      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "CHIEF_EDITOR_AGENT",
        revision_number: article.revision_count,
        verdict: review.chief_editor_verdict,
        feedback: `${review.chief_editor_feedback}\n\n修正指示: ${review.revision_instructions}`,
      });

      await supabase
        .from("gos_note_articles")
        .update({ current_stage: "FACT_CHECK", status: "AI_REVIEWED" })
        .eq("id", article.id);

      await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id);
      return { result: review };
    }

    case "FACT_CHECK": {
      const factCheck = await factCheckArticle({ body_markdown: article.body_markdown });

      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "FACT_CHECK_AGENT",
        revision_number: article.revision_count,
        verdict: factCheck.verdict,
        feedback: `${factCheck.feedback}${factCheck.issues.length ? `\n指摘事項: ${factCheck.issues.join(" / ")}` : ""}`,
      });

      // 事実面の問題は他のAgentが高得点でも公開ブロックする(多数決にしない)。
      if (factCheck.verdict !== "PASS") {
        return applyRevisionDecision(supabase, userId, article, 0, factCheck.feedback);
      }

      await supabase.from("gos_note_articles").update({ current_stage: "SALES_EDIT" }).eq("id", article.id);
      await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id);
      return { result: factCheck };
    }

    case "SALES_EDIT": {
      const salesEdit = await salesEditArticle({
        title: article.title,
        body_markdown: article.body_markdown,
        articleType: article.type,
        price: article.price,
      });

      await insertAiReview(supabase, userId, {
        target_type: "NOTE_ARTICLE",
        target_id: article.id,
        agent_type: "SALES_EDITOR_AGENT",
        revision_number: article.revision_count,
        score: salesEdit.quality_score,
        verdict: salesEdit.verdict,
        feedback: salesEdit.feedback,
      });

      const title = salesEdit.suggested_title ?? article.title;
      return applyRevisionDecision(supabase, userId, article, salesEdit.quality_score, salesEdit.feedback, title);
    }

    default:
      return { result: null };
  }
}

async function applyRevisionDecision(
  supabase: SupabaseClient,
  userId: string,
  article: NoteArticle,
  qualityScore: number,
  feedback: string,
  newTitle?: string
) {
  if (qualityScore >= QUALITY_BAR) {
    await supabase
      .from("gos_note_articles")
      .update({
        current_stage: "DONE",
        status: "WAITING_APPROVAL",
        quality_score: qualityScore,
        quality_below_threshold: false,
        ...(newTitle ? { title: newTitle } : {}),
      })
      .eq("id", article.id);
    return { result: { finished: true, quality_score: qualityScore } };
  }

  if (article.revision_count < 3) {
    await supabase
      .from("gos_note_articles")
      .update({
        current_stage: "RESEARCH",
        status: "DRAFT",
        revision_count: article.revision_count + 1,
        quality_score: qualityScore,
      })
      .eq("id", article.id);

    await enqueueJob(supabase, userId, "ARTICLE_ADVANCE", "NOTE_ARTICLE", article.id, {
      revision_feedback: feedback,
    });
    return { result: { finished: false, revision: article.revision_count + 1, quality_score: qualityScore } };
  }

  // 修正3回到達。品質基準未達でもサイレント公開はせず、人間の判断に委ねる。
  await supabase
    .from("gos_note_articles")
    .update({
      current_stage: "DONE",
      status: "WAITING_APPROVAL",
      quality_score: qualityScore,
      quality_below_threshold: true,
    })
    .eq("id", article.id);

  return { result: { finished: true, quality_score: qualityScore, quality_below_threshold: true } };
}
