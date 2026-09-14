import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listNoteArticles } from "@/lib/growth-os/db/articles";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { NOTE_ARTICLE_STAGE_LABELS } from "@/lib/growth-os/types";
import { GROWTH_OS_NOTE_ROUTE } from "@/lib/routes";

export const metadata: Metadata = { title: "note | note Growth OS" };

export default async function NoteArticlesPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const articles = await listNoteArticles(supabase, userId);

  return (
    <div>
      <PageHeader title="note" subtitle="7Agent工程の進捗を確認し、Markdown出力・コピーして公開する" />

      <div className="grid gap-3">
        {articles.length === 0 && (
          <p className="text-sm text-gray-400">まだnote記事がありません。Ideasから「無料/有料noteを作る」を実行してください。</p>
        )}
        {articles.map((article) => (
          <Link key={article.id} href={`${GROWTH_OS_NOTE_ROUTE}/${article.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{article.title || "(執筆中)"}</p>
                  <p className="mt-1 truncate text-xs text-gray-400">
                    {article.type === "PAID" ? `有料note (¥${article.price ?? "未設定"})` : "無料note"} ・{" "}
                    {NOTE_ARTICLE_STAGE_LABELS[article.current_stage]}
                    {article.revision_count > 0 && ` ・ 修正${article.revision_count}回目`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {article.quality_below_threshold && <Badge variant="warning">品質基準未達</Badge>}
                  {article.quality_score !== null && (
                    <span className="font-mono text-xs text-gray-400">{article.quality_score}点</span>
                  )}
                  <StatusBadge status={article.status} />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
