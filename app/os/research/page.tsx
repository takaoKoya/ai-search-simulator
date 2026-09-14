import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listResearchItems } from "@/lib/growth-os/db/research";
import { createResearchItemAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { GROWTH_OS_RESEARCH_ROUTE } from "@/lib/routes";

export const metadata: Metadata = { title: "Research | note Growth OS" };

export default async function ResearchPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const items = await listResearchItems(supabase, userId);

  return (
    <div>
      <PageHeader title="Research" subtitle="市場調査メモを記録し、HARM分類とスコアをAIに付けてもらう" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>新規登録</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createResearchItemAction} className="grid gap-3 md:grid-cols-2">
            <Input name="title" placeholder="タイトル(必須)" required />
            <Input name="source" placeholder="出典(例: X, ニュース記事, ヒアリング)" defaultValue="手動入力" />
            <Input name="source_url" placeholder="元URL" type="url" />
            <Input name="keyword" placeholder="検索語" />
            <Input name="target_age" placeholder="想定読者年齢(例: 50代前半)" />
            <Textarea name="summary" placeholder="要約" className="md:col-span-2" rows={3} />
            <div className="md:col-span-2">
              <Button size="md" type="submit">
                登録する
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {items.length === 0 && <p className="text-sm text-gray-400">まだResearchが登録されていません。</p>}
        {items.map((item) => (
          <Link key={item.id} href={`${GROWTH_OS_RESEARCH_ROUTE}/${item.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{item.title}</p>
                  <p className="mt-1 truncate text-xs text-gray-400">
                    {item.source} ・ {new Date(item.created_at).toLocaleDateString("ja-JP")}
                    {item.harm_type.length > 0 && ` ・ ${item.harm_type.join("/")}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {item.trend_score !== null && (
                    <span className="font-mono text-xs text-gray-400">trend {item.trend_score}</span>
                  )}
                  <StatusBadge status={item.status} />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
