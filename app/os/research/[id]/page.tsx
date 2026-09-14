import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getResearchItem } from "@/lib/growth-os/db/research";
import { listAiReviewsForTarget } from "@/lib/growth-os/db/reviews";
import { runResearchClassifyAction, promoteResearchToIdeaAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";

export const metadata: Metadata = { title: "Research detail | note Growth OS" };

export default async function ResearchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const item = await getResearchItem(supabase, userId, id);
  if (!item) notFound();

  const reviews = await listAiReviewsForTarget(supabase, userId, "RESEARCH_ITEM", id);

  return (
    <div>
      <PageHeader
        title={item.title}
        subtitle={`${item.source} ・ ${new Date(item.created_at).toLocaleDateString("ja-JP")}`}
        actions={
          <>
            <form action={runResearchClassifyAction.bind(null, item.id)}>
              <Button size="md" type="submit">
                AI分類を実行
              </Button>
            </form>
            {item.status !== "PROMOTED" && (
              <form action={promoteResearchToIdeaAction.bind(null, item.id)}>
                <Button
                  size="md"
                  type="submit"
                  className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                >
                  Ideaに昇格
                </Button>
              </form>
            )}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>内容</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-neutral-700">
            {item.summary && <p className="whitespace-pre-wrap">{item.summary}</p>}
            {item.source_url && (
              <p>
                <a href={item.source_url} target="_blank" rel="noreferrer" className="underline">
                  元URLを開く
                </a>
              </p>
            )}
            <p className="text-gray-400">想定読者年齢: {item.target_age ?? "未設定"}</p>
            <p className="text-gray-400">検索語: {item.keyword ?? "未設定"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI分類結果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">ステータス</span>
              <StatusBadge status={item.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">HARM分類</span>
              <span>{item.harm_type.length > 0 ? item.harm_type.join(" / ") : "-"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">trend_score</span>
              <span className="font-mono">{item.trend_score ?? "-"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">pain_score</span>
              <span className="font-mono">{item.pain_score ?? "-"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {reviews.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>AI評価理由</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reviews.map((r) => (
              <p key={r.id} className="text-sm whitespace-pre-wrap text-neutral-700">
                {r.feedback}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
