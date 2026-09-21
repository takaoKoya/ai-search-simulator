import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getResearchItem } from "@/lib/growth-os/db/research";
import { listAiReviewsForTarget } from "@/lib/growth-os/db/reviews";
import { listIdeaIdsForResearchItem } from "@/lib/growth-os/db/ideaSources";
import { getIdeasByIds } from "@/lib/growth-os/db/ideas";
import { runResearchAnalysisAction, generateIdeasFromResearchAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge, ScoreBandBadge } from "@/components/growth-os/shared/StatusBadge";
import { GROWTH_OS_IDEAS_ROUTE } from "@/lib/routes";
import { HARM_TYPE_LABELS, RESEARCH_SOURCE_TYPE_LABELS } from "@/lib/growth-os/types";

export const metadata: Metadata = { title: "Research detail | note Growth OS" };

export default async function ResearchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const item = await getResearchItem(supabase, userId, id);
  if (!item) notFound();

  const [reviews, relatedIdeaIds] = await Promise.all([
    listAiReviewsForTarget(supabase, userId, "RESEARCH_ITEM", id),
    listIdeaIdsForResearchItem(supabase, userId, id),
  ]);
  const relatedIdeas = await getIdeasByIds(supabase, userId, relatedIdeaIds);

  const isAnalyzed = item.analysis_version > 0;

  return (
    <div>
      <PageHeader
        title={item.title}
        subtitle={`${item.source_name} ・ 取得日 ${new Date(item.collected_at).toLocaleDateString("ja-JP")}`}
        actions={
          <>
            <form action={runResearchAnalysisAction.bind(null, item.id)}>
              <Button size="md" type="submit">
                AI分析を実行
              </Button>
            </form>
            <form action={generateIdeasFromResearchAction}>
              <input type="hidden" name="research_ids" value={item.id} />
              <Button size="md" type="submit" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50">
                このResearchからIdea生成
              </Button>
            </form>
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
            {item.raw_text && (
              <details className="rounded-lg border border-gray-100 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-gray-400 uppercase">原文/メモ</summary>
                <p className="mt-2 whitespace-pre-wrap text-gray-600">{item.raw_text}</p>
              </details>
            )}
            {item.source_url && (
              <p>
                <a href={item.source_url} target="_blank" rel="noreferrer" className="underline">
                  元URLを開く
                </a>
              </p>
            )}
            <p className="text-gray-400">
              想定読者年齢: {item.target_age_min ?? "?"}〜{item.target_age_max ?? "?"}歳
            </p>
            <p className="text-gray-400">検索語: {item.keyword ?? "未設定"}</p>
            <p className="text-gray-400">出典種別: {RESEARCH_SOURCE_TYPE_LABELS[item.source_type]}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI分析結果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">ステータス</span>
              <StatusBadge status={item.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">HARM分類</span>
              <span>{item.harm_types.length > 0 ? item.harm_types.map((h) => HARM_TYPE_LABELS[h]).join(" / ") : "-"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Trend Score</span>
              <span className="font-mono">{item.trend_score ?? "-"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Pain Score</span>
              <span className="font-mono">{item.pain_score ?? "-"}</span>
            </div>
            {!isAnalyzed && <p className="text-xs text-gray-400">まだAI分析されていません。「AI分析を実行」してください。</p>}
          </CardContent>
        </Card>
      </div>

      {isAnalyzed && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>悩みの抽出</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">表面的な悩み</p>
              <p className="text-sm text-neutral-700">{item.surface_problem}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">深層の悩み</p>
              <p className="text-sm text-neutral-700">{item.deep_problem}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">感情トリガー</p>
              <p className="text-sm text-neutral-700">{item.emotional_trigger}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {relatedIdeas.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>関連Idea</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedIdeas.map((idea) => (
              <Link
                key={idea.id}
                href={`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <span>{idea.title}</span>
                <ScoreBandBadge totalScore={idea.total_score} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

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
