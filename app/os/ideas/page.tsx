import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listIdeas } from "@/lib/growth-os/db/ideas";
import { createIdeaManuallyAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { ScoreBandBadge, IdeaStatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { IdeaCard } from "@/components/growth-os/ideas/IdeaCard";
import { GROWTH_OS_IDEAS_ROUTE } from "@/lib/routes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ideas | note Growth OS" };

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const isTable = view === "table";
  const { supabase, userId } = await requireGrowthOsUser();
  const ideas = await listIdeas(supabase, userId);

  return (
    <div>
      <PageHeader
        title="Ideas"
        subtitle="9軸スコアリングでコンテンツ候補を評価する(合計100点、デフォルトはスコア順)"
        actions={
          <div className="flex overflow-hidden rounded-lg border border-gray-200">
            <Link
              href={`${GROWTH_OS_IDEAS_ROUTE}?view=card`}
              className={cn("px-3 py-1.5 text-sm", !isTable ? "bg-neutral-900 text-white" : "bg-white text-gray-500")}
            >
              カード
            </Link>
            <Link
              href={`${GROWTH_OS_IDEAS_ROUTE}?view=table`}
              className={cn("px-3 py-1.5 text-sm", isTable ? "bg-neutral-900 text-white" : "bg-white text-gray-500")}
            >
              テーブル
            </Link>
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>新規登録(手動)</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createIdeaManuallyAction} className="grid gap-3 md:grid-cols-2">
            <Input name="title" placeholder="テーマ(必須)" required className="md:col-span-2" />
            <Textarea name="summary" placeholder="概要" className="md:col-span-2" rows={2} />
            <div className="md:col-span-2">
              <Button size="md" type="submit">
                登録する
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {ideas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-500">
            まだIdeaがありません。Researchから生成するか、上のフォームから手動で追加してください。
          </CardContent>
        </Card>
      ) : isTable ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-400">
              <tr>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2 font-medium">HARM</th>
                <th className="px-3 py-2 font-medium">推奨</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((idea) => (
                <tr key={idea.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <Link href={`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`} className="font-medium text-neutral-900 hover:underline">
                      {idea.title}
                    </Link>
                    {idea.most_similar_idea_id && (
                      <Badge variant="warning" className="ml-2">
                        類似Ideaあり
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{idea.total_score}</span>
                      <ScoreBandBadge totalScore={idea.total_score} />
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-500">{idea.confidence_score ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-500">{idea.harm_types.join(" / ") || "-"}</td>
                  <td className="px-3 py-2 text-gray-500">{idea.recommended_free_or_paid ?? "-"}</td>
                  <td className="px-3 py-2">
                    <IdeaStatusBadge status={idea.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      )}
    </div>
  );
}
