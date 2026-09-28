import type { Metadata } from "next";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { countJobsCreatedToday, getDailyAiJobLimit } from "@/lib/growth-os/db/settings";
import { sumEstimatedCostThisMonth } from "@/lib/growth-os/db/jobs";
import { updateDailyJobLimitAction, updateWritingProfileAction } from "@/lib/growth-os/actions";
import { getWritingProfile } from "@/lib/growth-os/db/writingProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { IDEA_SCORE_CRITERIA } from "@/lib/growth-os/types";

export const metadata: Metadata = { title: "Settings | note Growth OS" };

export default async function SettingsPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const [limit, usedToday, monthlyCostUsd, writingProfile] = await Promise.all([
    getDailyAiJobLimit(supabase, userId),
    countJobsCreatedToday(supabase, userId),
    sumEstimatedCostThisMonth(supabase, userId),
    getWritingProfile(supabase, userId),
  ]);

  return (
    <div>
      <PageHeader title="Settings" subtitle="AI利用の予算上限とスコア基準を確認・調整する" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>今月のAI使用量</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-2xl font-semibold text-neutral-900">
            ${monthlyCostUsd.toFixed(4)}
            <span className="ml-2 text-sm font-normal text-gray-400">(概算・Anthropic公式料金表ベース)</span>
          </p>
          <p className="mt-1 text-xs text-gray-400">
            gos_ai_jobsに記録されたinput/output tokens×モデル別単価から算出した参考値です。実際の請求額はAnthropicコンソールを確認してください。
          </p>
        </CardContent>
      </Card>

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
            90点以上=最優先候補 / 85〜89点=制作候補 / 75〜84点=保留候補 / 74点以下=低優先(表示ラベルはtotal_scoreの帯によるもので、
            statusとは別に算出されます)
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Writing Profile(あなたの声)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-gray-400">
            Threads/note生成時にAIが参考にする文体設定です。あなた自身の言葉づかいに近づけるほど、AI臭を減らせます。
          </p>
          <form action={updateWritingProfileAction} className="space-y-4 text-sm">
            <div>
              <label className="mb-1 block text-xs text-gray-400" htmlFor="preferred_tone">
                トーン(自由記述)
              </label>
              <Input
                id="preferred_tone"
                name="preferred_tone"
                defaultValue={writingProfile?.preferred_tone ?? ""}
                placeholder="例: 落ち着いた、親しみやすい、断定しすぎない"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400" htmlFor="sentence_length">
                  文の長さ
                </label>
                <Select id="sentence_length" name="sentence_length" defaultValue={writingProfile?.sentence_length ?? "MEDIUM"}>
                  <option value="SHORT">短め</option>
                  <option value="MEDIUM">標準</option>
                  <option value="LONG">長め</option>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400" htmlFor="line_break_style">
                  改行スタイル
                </label>
                <Select id="line_break_style" name="line_break_style" defaultValue={writingProfile?.line_break_style ?? "MODERATE"}>
                  <option value="FREQUENT">こまめに改行</option>
                  <option value="MODERATE">標準</option>
                  <option value="MINIMAL">改行少なめ</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {(
                [
                  { key: "humor_level", label: "ユーモア度" },
                  { key: "directness", label: "率直さ" },
                  { key: "emotional_level", label: "感情表現の強さ" },
                  { key: "technical_level", label: "専門用語レベル" },
                  { key: "emoji_level", label: "絵文字使用度" },
                ] as const
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs text-gray-400" htmlFor={key}>
                    {label}(0-100)
                  </label>
                  <Input
                    id={key}
                    name={key}
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={writingProfile?.[key] ?? 30}
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-400" htmlFor="ng_phrases">
                NGフレーズ(カンマ区切り)
              </label>
              <Textarea
                id="ng_phrases"
                name="ng_phrases"
                rows={2}
                defaultValue={writingProfile?.ng_phrases.join("、") ?? ""}
                placeholder="例: 結論から言うと、〜なのです"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400" htmlFor="preferred_phrases">
                好むフレーズ(カンマ区切り)
              </label>
              <Textarea
                id="preferred_phrases"
                name="preferred_phrases"
                rows={2}
                defaultValue={writingProfile?.preferred_phrases.join("、") ?? ""}
              />
            </div>

            <Button size="md" type="submit">
              保存する
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
