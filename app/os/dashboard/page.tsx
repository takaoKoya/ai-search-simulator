import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getTodaysTopIdea, listIdeas } from "@/lib/growth-os/db/ideas";
import { listThreadsPosts } from "@/lib/growth-os/db/threads";
import { listNoteArticles } from "@/lib/growth-os/db/articles";
import { listContentMetrics } from "@/lib/growth-os/db/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { TierBadge, StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { IdeaApprovalActions } from "@/components/growth-os/dashboard/IdeaApprovalActions";
import {
  GROWTH_OS_IDEAS_ROUTE,
  GROWTH_OS_NOTE_ROUTE,
  GROWTH_OS_THREADS_ROUTE,
} from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard | note Growth OS" };

export default async function DashboardPage() {
  const { supabase, userId } = await requireGrowthOsUser();

  const [topIdea, allIdeas, threadsPosts, articles, metrics] = await Promise.all([
    getTodaysTopIdea(supabase, userId),
    listIdeas(supabase, userId),
    listThreadsPosts(supabase, userId),
    listNoteArticles(supabase, userId),
    listContentMetrics(supabase, userId),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const publishedThisMonth = articles.filter((a) => a.published_at && new Date(a.published_at) >= monthStart);
  const threadsPublishedThisMonth = threadsPosts.filter(
    (t) => t.published_at && new Date(t.published_at) >= monthStart
  );
  const salesThisMonth = metrics
    .filter((m) => new Date(m.metric_date) >= monthStart)
    .reduce((sum, m) => sum + Number(m.sales_amount), 0);

  const waitingThreads = threadsPosts.filter((t) => t.status === "WAITING_APPROVAL");
  const waitingArticles = articles.filter((a) => a.status === "WAITING_APPROVAL");

  const risingIdeas = allIdeas.filter((i) => i.status === "NEW" && i.id !== topIdea?.id).slice(0, 3);
  const recentMetrics = metrics.slice(-5).reverse();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={now.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="今月の売上" value={`¥${salesThisMonth.toLocaleString()}`} />
        <StatTile label="今月のnote公開数" value={String(publishedThisMonth.length)} />
        <StatTile label="今月のThreads投稿数" value={String(threadsPublishedThisMonth.length)} />
        <StatTile label="承認待ち" value={String(waitingThreads.length + waitingArticles.length)} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>今日作るべきコンテンツ</CardTitle>
        </CardHeader>
        <CardContent>
          {topIdea ? (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TierBadge tier={topIdea.tier} />
                <span className="font-mono text-sm text-gray-400">{topIdea.total_score}点</span>
              </div>
              <h2 className="mb-1 text-lg font-semibold text-neutral-900">{topIdea.title}</h2>
              {topIdea.summary && <p className="mb-4 text-sm text-gray-500">{topIdea.summary}</p>}
              <IdeaApprovalActions ideaId={topIdea.id} />
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              未着手のIdeaがありません。
              <Link href={GROWTH_OS_IDEAS_ROUTE} className="ml-1 underline">
                Ideasで新しいテーマを追加
              </Link>
              するか、Researchから昇格させてください。
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>承認待ち</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {waitingThreads.length === 0 && waitingArticles.length === 0 && (
              <p className="text-sm text-gray-400">承認待ちの項目はありません。</p>
            )}
            {waitingThreads.map((t) => (
              <Link
                key={t.id}
                href={`${GROWTH_OS_THREADS_ROUTE}/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <span>Threads: {t.pattern_type}</span>
                <StatusBadge status={t.status} />
              </Link>
            ))}
            {waitingArticles.map((a) => (
              <Link
                key={a.id}
                href={`${GROWTH_OS_NOTE_ROUTE}/${a.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <span>note: {a.title || "(無題)"}</span>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>急上昇テーマ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {risingIdeas.length === 0 && <p className="text-sm text-gray-400">他に未着手のIdeaはありません。</p>}
            {risingIdeas.map((idea) => (
              <Link
                key={idea.id}
                href={`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <span>{idea.title}</span>
                <TierBadge tier={idea.tier} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>最近の成績</CardTitle>
        </CardHeader>
        <CardContent>
          {recentMetrics.length === 0 ? (
            <p className="text-sm text-gray-400">まだメトリクスが記録されていません。Analyticsから記録してください。</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400">
                  <th className="pb-2 font-medium">日付</th>
                  <th className="pb-2 font-medium">テーマ</th>
                  <th className="pb-2 font-medium">PV</th>
                  <th className="pb-2 font-medium">スキ</th>
                </tr>
              </thead>
              <tbody>
                {recentMetrics.map((m) => (
                  <tr key={m.id} className="border-t border-gray-100">
                    <td className="py-2 font-mono text-xs">{m.metric_date}</td>
                    <td className="py-2">{m.theme_tag ?? "-"}</td>
                    <td className="py-2 font-mono">{m.pv}</td>
                    <td className="py-2 font-mono">{m.likes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="mt-1 font-mono text-xl font-semibold text-neutral-900">{value}</p>
      </CardContent>
    </Card>
  );
}
