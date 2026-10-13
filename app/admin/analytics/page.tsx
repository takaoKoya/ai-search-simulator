import Link from "next/link";
import { ChannelAnalytics } from "@/components/admin/ChannelAnalytics";
import { PeriodFilter } from "@/components/admin/PeriodFilter";
import { formatDateOnly, resolvePeriod } from "@/lib/analytics/period";
import { getChannelSummary } from "@/lib/analytics/query";
import { firstParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const resolved = resolvePeriod({
    range: firstParam(sp.range),
    startDate: firstParam(sp.startDate),
    endDate: firstParam(sp.endDate),
  });
  const period = resolved.ok ? resolved.period : { range: "all" as const, start: null, end: null };
  const summary = await getChannelSummary(undefined, period);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <Link href="/admin/jobs" className="text-sm text-neutral-500 hover:underline">
        ← 求人一覧
      </Link>
      <h1 className="text-2xl font-bold">アナリティクス（全求人）</h1>
      <PeriodFilter range={period.range} startDate={formatDateOnly(period.start)} endDate={formatDateOnly(period.end)} />
      {!resolved.ok && (
        <p role="alert" className="text-sm text-red-600">
          {resolved.error}（全期間で表示しています）
        </p>
      )}
      <ChannelAnalytics title="チャネル別の流入・応募" summary={summary} />
    </div>
  );
}
