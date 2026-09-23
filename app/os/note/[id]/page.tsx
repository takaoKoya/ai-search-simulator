import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getNoteArticle } from "@/lib/growth-os/db/articles";
import { listAiReviewsForTarget } from "@/lib/growth-os/db/reviews";
import { listJobsForTarget } from "@/lib/growth-os/db/jobs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { PipelineStatus } from "@/components/growth-os/note/PipelineStatus";
import { ArticleActions } from "@/components/growth-os/note/ArticleActions";
import { AgentReviewPanel } from "@/components/growth-os/note/AgentReviewPanel";

export const metadata: Metadata = { title: "note detail | note Growth OS" };

export default async function NoteArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const article = await getNoteArticle(supabase, userId, id);
  if (!article) notFound();

  const [reviews, jobs] = await Promise.all([
    listAiReviewsForTarget(supabase, userId, "NOTE_ARTICLE", id),
    listJobsForTarget(supabase, userId, id),
  ]);

  const hasPendingJob = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING");

  return (
    <div>
      <PageHeader
        title={article.title || "(執筆中)"}
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
            <PipelineStatus currentStage={article.current_stage} />
            {article.quality_score !== null && (
              <p className="mt-4 text-sm text-gray-500">
                最終品質スコア: <span className="font-mono font-semibold text-neutral-900">{article.quality_score}点</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>本文</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ArticleActions article={article} hasPendingJob={hasPendingJob} />
            {article.body_markdown ? (
              <pre className="max-h-96 overflow-y-auto rounded-lg bg-gray-50 p-4 text-sm whitespace-pre-wrap text-neutral-800">
                {article.body_markdown}
              </pre>
            ) : (
              <p className="text-sm text-gray-400">まだ本文が生成されていません。「AI処理を実行」から開始してください。</p>
            )}
          </CardContent>
        </Card>
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
