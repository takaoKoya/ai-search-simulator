import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listResearchItems } from "@/lib/growth-os/db/research";
import { createResearchItemAction, generateIdeasFromResearchAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { GROWTH_OS_RESEARCH_ROUTE } from "@/lib/routes";
import { HARM_TYPE_LABELS, HARM_TYPES, RESEARCH_SOURCE_TYPE_LABELS, type HarmType, type ResearchSourceType } from "@/lib/growth-os/types";

export const metadata: Metadata = { title: "Research | note Growth OS" };

interface SearchParams {
  q?: string;
  source_type?: string;
  harm_type?: string;
  from?: string;
  to?: string;
  min_trend?: string;
  min_pain?: string;
}

export default async function ResearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, userId } = await requireGrowthOsUser();

  const items = await listResearchItems(supabase, userId, {
    search: params.q,
    sourceType: params.source_type as ResearchSourceType | undefined,
    harmType: params.harm_type as HarmType | undefined,
    collectedFrom: params.from,
    collectedTo: params.to,
    minTrendScore: params.min_trend ? Number(params.min_trend) : undefined,
    minPainScore: params.min_pain ? Number(params.min_pain) : undefined,
  });

  return (
    <div>
      <PageHeader title="Research" subtitle="市場調査メモを記録し、AIに悩みの抽出とHARM分類を行わせる" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Researchを追加</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createResearchItemAction} className="grid gap-3 md:grid-cols-2">
            <Input name="title" placeholder="タイトル(必須)" required className="md:col-span-2" />
            <Select name="source_type" defaultValue="MANUAL">
              {Object.entries(RESEARCH_SOURCE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Input name="source_name" placeholder="出典名(例: X, Yahoo!ニュース、必須)" required />
            <Input name="source_url" placeholder="元URL(任意)" type="url" />
            <Input name="keyword" placeholder="検索語" />
            <Input name="target_age_min" placeholder="対象年齢(最小、例: 50)" type="number" min={0} max={120} />
            <Input name="target_age_max" placeholder="対象年齢(最大、例: 59)" type="number" min={0} max={120} />
            <Textarea name="summary" placeholder="要約" className="md:col-span-2" rows={2} />
            <Textarea name="raw_text" placeholder="本文/メモ(見つけた記事・投稿の原文をそのまま貼ってもOK)" className="md:col-span-2" rows={4} />
            <div className="md:col-span-2">
              <Button size="md" type="submit">
                登録する
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="py-4">
          <form className="grid gap-3 md:grid-cols-6">
            <Input name="q" placeholder="検索(タイトル/検索語)" defaultValue={params.q} className="md:col-span-2" />
            <Select name="source_type" defaultValue={params.source_type ?? ""}>
              <option value="">Source: すべて</option>
              {Object.entries(RESEARCH_SOURCE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select name="harm_type" defaultValue={params.harm_type ?? ""}>
              <option value="">HARM: すべて</option>
              {HARM_TYPES.map((h) => (
                <option key={h} value={h}>
                  {HARM_TYPE_LABELS[h]}
                </option>
              ))}
            </Select>
            <Input name="from" type="date" defaultValue={params.from} />
            <Input name="to" type="date" defaultValue={params.to} />
            <Input name="min_trend" type="number" min={0} max={100} placeholder="Trend最小" defaultValue={params.min_trend} />
            <Input name="min_pain" type="number" min={0} max={100} placeholder="Pain最小" defaultValue={params.min_pain} />
            <div className="md:col-span-2">
              <Button size="md" type="submit" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50">
                絞り込む
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-500">
            まだResearchがありません。最初の市場情報を追加すると、AIが悩みとコンテンツ候補を分析します。
          </CardContent>
        </Card>
      ) : (
        <form action={generateIdeasFromResearchAction}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-gray-400">チェックした複数のResearchから、まとめてIdeaを生成できます。</p>
            <Button size="md" type="submit" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50">
              選択した情報からIdea生成
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-400">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">HARM</th>
                  <th className="px-3 py-2 font-medium">Trend</th>
                  <th className="px-3 py-2 font-medium">Pain</th>
                  <th className="px-3 py-2 font-medium">取得日</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <input type="checkbox" name="research_ids" value={item.id} />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`${GROWTH_OS_RESEARCH_ROUTE}/${item.id}`} className="font-medium text-neutral-900 hover:underline">
                        {item.title}
                      </Link>
                      {item.keyword && <span className="ml-2 text-xs text-gray-400">#{item.keyword}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{item.source_name}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {item.harm_types.map((h) => (
                          <Badge key={h} variant="neutral">
                            {h}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-500">{item.trend_score ?? "-"}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{item.pain_score ?? "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-400">
                      {new Date(item.collected_at).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </div>
  );
}
