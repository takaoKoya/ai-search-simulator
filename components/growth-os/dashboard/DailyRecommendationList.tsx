import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyRecommendation } from "@/lib/growth-os/dailyRecommendation";
import { GROWTH_OS_IDEAS_ROUTE } from "@/lib/routes";

export function DailyRecommendationList({ recommendations }: { recommendations: DailyRecommendation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>今日の推奨テーマ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recommendations.length === 0 && <p className="text-sm text-gray-400">他に提示できる候補がありません。</p>}
        {recommendations.map((rec, index) => (
          <Link
            key={rec.ideaId}
            href={`${GROWTH_OS_IDEAS_ROUTE}/${rec.ideaId}`}
            className="flex items-start gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
          >
            <span className="mt-0.5 font-mono text-xs text-gray-400">{index + 2}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900">{rec.title}</p>
              <p className="mt-0.5 text-xs text-gray-400">{rec.reason}</p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
