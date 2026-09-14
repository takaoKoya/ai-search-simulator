import type { Metadata } from "next";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { countJobsCreatedToday, getDailyAiJobLimit } from "@/lib/growth-os/db/settings";
import { updateDailyJobLimitAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { IDEA_SCORE_CRITERIA } from "@/lib/growth-os/types";

export const metadata: Metadata = { title: "Settings | note Growth OS" };

export default async function SettingsPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const [limit, usedToday] = await Promise.all([
    getDailyAiJobLimit(supabase, userId),
    countJobsCreatedToday(supabase, userId),
  ]);

  return (
    <div>
      <PageHeader title="Settings" subtitle="AI利用の予算上限とスコア基準を確認・調整する" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>AIジョブの1日あたり上限</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-gray-500">本日の利用状況</span>
              <span className="font-mono text-gray-900">
                {usedToday} / {limit} 件
              </span>
            </div>
            <Progress value={(usedToday / limit) * 100} />
          </div>
          <form action={updateDailyJobLimitAction} className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400" htmlFor="daily_ai_job_limit">
                1日の上限件数
              </label>
              <Input
                id="daily_ai_job_limit"
                name="daily_ai_job_limit"
                type="number"
                min={1}
                defaultValue={limit}
                className="w-32"
              />
            </div>
            <Button size="md" type="submit">
              更新する
            </Button>
          </form>
          <p className="text-xs text-gray-400">
            Claude APIの呼び出しが暴走してコストが跳ね上がらないよう、1日に生成できるAIジョブ数の上限です。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ideaスコアリング基準(9軸・合計100点)</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400">
                <th className="pb-2 font-medium">評価軸</th>
                <th className="pb-2 font-medium">配点</th>
              </tr>
            </thead>
            <tbody>
              {IDEA_SCORE_CRITERIA.map((c) => (
                <tr key={c.key} className="border-t border-gray-100">
                  <td className="py-2">{c.label}</td>
                  <td className="py-2 font-mono">{c.weight}点</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-400">
            90点以上=最優先 / 85〜89点=制作候補 / 75〜84点=保留 / 74点以下=原則不採用
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
