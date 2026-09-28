import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listArticlesAwaitingApproval } from "@/lib/growth-os/db/articles";
import { listThreadsPosts } from "@/lib/growth-os/db/threads";
import { listFactClaims } from "@/lib/growth-os/db/factClaims";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { THREADS_PATTERN_LABELS, meetsThreadsQualityBar } from "@/lib/growth-os/types";
import { GROWTH_OS_NOTE_ROUTE, GROWTH_OS_THREADS_ROUTE } from "@/lib/routes";

export const metadata: Metadata = { title: "承認キュー | note Growth OS" };

/**
 * Approval Queue(セクション23)。1日10〜15分でThreads/note/Outline/Fact Check警告を
 * まとめてレビューできるよう、WAITING_APPROVAL相当のものだけをここに集約する。
 */
export default async function ApprovalQueuePage() {
  const { supabase, userId } = await requireGrowthOsUser();

  const [articles, threadsPosts] = await Promise.all([
    listArticlesAwaitingApproval(supabase, userId),
    listThreadsPosts(supabase, userId),
  ]);

  const pendingThreads = threadsPosts.filter((p) => p.status === "WAITING_APPROVAL");
  const factClaimCounts = await Promise.all(
    articles.map(async (a) => ({ articleId: a.id, claims: await listFactClaims(supabase, userId, a.id) }))
  );
  const unverifiedByArticle = new Map(
    factClaimCounts.map(({ articleId, claims }) => [articleId, claims.filter((c) => c.classification === "UNVERIFIED").length])
  );

  const isEmpty = articles.length === 0 && pendingThreads.length === 0;

  return (
    <div>
      <PageHeader title="承認キュー" subtitle="AIが用意したもののうち、人間の確認・承認が必要なものだけをまとめて表示します" />

      {isEmpty && <p className="text-sm text-gray-400">現在、承認待ちのコンテンツはありません。</p>}

      {articles.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-neutral-900">note(Outline承認・最終承認)</h2>
          <div className="grid gap-3">
            {articles.map((article) => (
              <Link key={article.id} href={`${GROWTH_OS_NOTE_ROUTE}/${article.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-900">{article.title || "(企画中)"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                        <span>{article.type === "PAID" ? "有料note" : "無料note"}</span>
                        {article.status === "OUTLINE" && <Badge variant="info">Outline承認待ち</Badge>}
                        {article.quality_score !== null && <span>品質スコア {article.quality_score}点</span>}
                        {article.quality_below_threshold && <Badge variant="warning">品質基準未達</Badge>}
                        {(unverifiedByArticle.get(article.id) ?? 0) > 0 && (
                          <Badge variant="critical">未検証{unverifiedByArticle.get(article.id)}件</Badge>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={article.status} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {pendingThreads.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900">Threads(承認待ち)</h2>
          <div className="grid gap-3">
            {pendingThreads.map((post) => (
              <Link key={post.id} href={`${GROWTH_OS_THREADS_ROUTE}/${post.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-neutral-800">{post.body}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                        <span>{THREADS_PATTERN_LABELS[post.pattern_type]}</span>
                        {post.overall_score !== null && <span>総合 {post.overall_score}点</span>}
                        {meetsThreadsQualityBar(post) ? (
                          <Badge variant="success">品質基準クリア</Badge>
                        ) : (
                          <Badge variant="warning">品質基準未達</Badge>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={post.status} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
