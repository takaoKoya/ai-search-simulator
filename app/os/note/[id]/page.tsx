import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getNoteArticle } from "@/lib/growth-os/db/articles";
import { listAiReviewsForTarget } from "@/lib/growth-os/db/reviews";
import { listJobsForTarget } from "@/lib/growth-os/db/jobs";
import { listArticleSections } from "@/lib/growth-os/db/articleSections";
import { listFactClaims } from "@/lib/growth-os/db/factClaims";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { PipelineStatus } from "@/components/growth-os/note/PipelineStatus";
import { ArticleActions } from "@/components/growth-os/note/ArticleActions";
import { AgentReviewPanel } from "@/components/growth-os/note/AgentReviewPanel";
import { OutlineCard } from "@/components/growth-os/note/OutlineCard";
import { SectionEditor } from "@/components/growth-os/note/SectionEditor";
import { FactClaimsList } from "@/components/growth-os/note/FactClaimsList";
import { PaidCandidatePanel } from "@/components/growth-os/note/PaidCandidatePanel";

export const metadata: Metadata = { title: "note detail | note Growth OS" };

export default async function NoteArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const article = await getNoteArticle(supabase, userId, id);
  if (!article) notFound();

  const [reviews, jobs, sections, factClaims] = await Promise.all([
    listAiReviewsForTarget(supabase, userId, "NOTE_ARTICLE", id),
    listJobsForTarget(supabase, userId, id),
    listArticleSections(supabase, userId, id),
    listFactClaims(supabase, userId, id),
  ]);

  const hasPendingJob = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING");
  const showOutline = article.title_candidates.length > 0;
  const showSections = sections.length > 0 && article.status !== "OUTLINE";

  return (
    <div>
      <PageHeader
        title={article.title || "(企画中)"}
        subtitle={article.type === "PAID" ? `有料note ・ ¥${article.price ?? "未設定"}` : "無料note"}
        actions={<StatusBadge status={article.status} />}
      />

      {article.quality_below_threshold && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          品質スコアが3回の修正でも80点に達しませんでした({article.quality_score}点)。公開するかどうかは人間の判断で決めてください。
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>パイプライン進捗</CardTitle>
          </CardHeader>
          <CardContent>
            <PipelineStatus currentStatus={article.status} />
            {article.quality_score !== null && (
              <p className="mt-4 text-sm text-gray-500">
                最終品質スコア: <span className="font-mono font-semibold text-neutral-900">{article.quality_score}点</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{showOutline && article.status === "OUTLINE" ? "Outline(企画)" : "本文"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ArticleActions article={article} hasPendingJob={hasPendingJob} />

            {showOutline && <OutlineCard article={article} />}

            {showSections && (
              <div className="divide-y divide-gray-100 border-t border-gray-100 pt-2">
                {sections.map((section) => (
                  <SectionEditor key={section.id} section={section} />
                ))}
              </div>
            )}

            {!showOutline && sections.length === 0 && (
              <p className="text-sm text-gray-400">まだ企画・本文が生成されていません。「AI処理を実行」から開始してください。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fact Check</CardTitle>
          </CardHeader>
          <CardContent>
            <FactClaimsList claims={factClaims} />
          </CardContent>
        </Card>

        {article.type === "FREE" && (
          <Card>
            <CardHeader>
              <CardTitle>有料note候補判定</CardTitle>
            </CardHeader>
            <CardContent>
              <PaidCandidatePanel article={article} />
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Agentレビュー履歴</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentReviewPanel reviews={reviews} />
        </CardContent>
      </Card>
    </div>
  );
}
