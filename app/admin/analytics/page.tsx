import Link from "next/link";
import { ChannelAnalytics } from "@/components/admin/ChannelAnalytics";
import { getChannelSummary } from "@/lib/analytics/query";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const summary = await getChannelSummary();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <Link href="/admin/jobs" className="text-sm text-neutral-500 hover:underline">
        ← 求人一覧
      </Link>
      <h1 className="text-2xl font-bold">アナリティクス（全求人）</h1>
      <ChannelAnalytics title="チャネル別の流入・応募" summary={summary} />
    </div>
  );
}
