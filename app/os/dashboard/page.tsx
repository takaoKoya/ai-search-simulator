import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listIdeas, listRecentlyApprovedIdeas } from "@/lib/growth-os/db/ideas";
import { listResearchItems } from "@/lib/growth-os/db/research";
import { listThreadsPosts } from "@/lib/growth-os/db/threads";
import { listNoteArticles } from "@/lib/growth-os/db/articles";
import { recommendDailyIdeas } from "@/lib/growth-os/dailyRecommendation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { PriorityIdeaCard } from "@/components/growth-os/dashboard/PriorityIdeaCard";
import { DailyRecommendationList } from "@/components/growth-os/dashboard/DailyRecommendationList";
import { HarmDistribution } from "@/components/growth-os/dashboard/HarmDistribution";
import { GROWTH_OS_IDEAS_ROUTE, GROWTH_OS_NOTE_ROUTE, GROWTH_OS_RESEARCH_ROUTE, GROWTH_OS_THREADS_ROUTE } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard | note Growth OS" };

const ACTIONABLE = new Set(["NEW", "PRIORITY", "CANDIDATE", "HOLD"]);

export default async function DashboardPage() {
  const { supabase, userId } = await requireGrowthOsUser();

  const [ideas, recentlyApproved, researchItems, threadsPosts, articles] = await Promise.all([
    listIdeas(supabase, userId),
    listRecentlyApprovedIdeas(supabase, userId),
    listResearchItems(supabase, userId),
    listThreadsPosts(supabase, userId),
    listNoteArticles(supabase, userId),
  ]);

  const actionableIdeas = ideas.filter((i) => ACTIONABLE.has(i.status));
  const recommendations = recommendDailyIdeas(
    actionableIdeas.map((i) => ({
      id: i.id,
      title: i.title,
      totalScore: i.total_score,
      confidenceScore: i.confidence_score,
      freshnessScore: i.freshness_score,
      harmTypes: i.harm_types,
      status: i.status,
    })),
    recentlyApproved.map((i) => ({
      id: i.id,
      title: i.title,
      totalScore: i.total_score,
      confidenceScore: i.confidence_score,
      freshnessScore: i.freshness_score,
      harmTypes: i.harm_types,
      status: i.status,
    })),
    3
  );

  const heroIdea = recommendations.length > 0 ? ideas.find((i) => i.id === recommendations[0].ideaId) : undefined;
  const restRecommendations = recommendations.slice(1);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const newThemesThisWeek = ideas.filter((i) => new Date(i.created_at) >= weekAgo).length;
  const priorityCount = ideas.filter((i) => i.status === "PRIORITY").length;

  const waitingThreads = threadsPosts.filter((t) => t.status === "WAITING_APPROVAL");
  const waitingArticles = articles.filter((a) => a.status === "WAITING_APPROVAL");

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={now.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="最優先Ideas" value={String(priorityCount)} />
        <StatTile label="判断待ちIdeas" value={String(actionableIdeas.length)} />
        <StatTile label="Research件数" value={String(researchItems.length)} />
        <StatTile label="今週追加されたテーマ" value={String(newThemesThisWeek)} />
      </div>

      <div className="mb-6">
        <p className="mb-2 text-sm font-semibold text-gray-500">今日、何をすべきか</p>
        {heroIdea ? (
          <PriorityIdeaCard idea={heroIdea} />
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-gray-500">
              未評価/未採点のIdeaがありません。
              <Link href={GROWTH_OS_RESEARCH_ROUTE} className="ml-1 underline">
                Researchを追加
              </Link>
              してAI分析を実行するか、
              <Link href={GROWTH_OS_IDEAS_ROUTE} className="ml-1 underline">
                Ideasで新しいテーマを追加
              </Link>
              してください。
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DailyRecommendationList recommendations={restRecommendations} />
        <HarmDistribution harmTypes={ideas.map((i) => i.harm_types)} />
      </div>

      {(waitingThreads.length > 0 || waitingArticles.length > 0) && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>承認待ち(Threads / note)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
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
      )}
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
