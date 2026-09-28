import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getIdea } from "@/lib/growth-os/db/ideas";
import { getContentStrategyByIdea } from "@/lib/growth-os/db/contentStrategies";
import { listThreadsPostsByIdea } from "@/lib/growth-os/db/threads";
import { listArticlesByIdea } from "@/lib/growth-os/db/articles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { ThreadsPostCard } from "@/components/growth-os/threads/ThreadsPostCard";
import { NOTE_ARTICLE_STATUS_LABELS } from "@/lib/growth-os/types";
import { GROWTH_OS_IDEAS_ROUTE, GROWTH_OS_NOTE_ROUTE } from "@/lib/routes";

export const metadata: Metadata = { title: "コンテンツ作成 | note Growth OS" };

export default async function IdeaContentHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const idea = await getIdea(supabase, userId, id);
  if (!idea) notFound();

  const [strategy, threadsPosts, articles] = await Promise.all([
    getContentStrategyByIdea(supabase, userId, id),
    listThreadsPostsByIdea(supabase, userId, id),
    listArticlesByIdea(supabase, userId, id),
  ]);

  const isGenerating = !strategy && threadsPosts.length === 0;

  return (
    <div>
      <PageHeader
        title={idea.title}
        subtitle="Content Strategy → Threads 5案 → note企画・原稿 まで、このIdea1件分の進捗をまとめて確認します"
        actions={
          <Link href={`${GROWTH_OS_IDEAS_ROUTE}/${id}`} className="text-sm text-gray-500 underline">
            Idea詳細へ戻る
          </Link>
        }
      />

      {isGenerating && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          AIがContent Strategy・Threads・note企画を生成中です。数分後にこのページを再読み込みしてください。
        </div>
      )}

      {strategy && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Content Strategy(読者をどう動かすか)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <Field label="ターゲット読者" value={strategy.target_reader} />
            <Field label="現在地(Before)" value={strategy.reader_situation} />
            <Field label="表面的な悩み" value={strategy.surface_problem} />
            <Field label="本質的な悩み" value={strategy.deep_problem} />
            <Field label="読後に得たい感情" value={strategy.desired_emotion} />
            <Field label="取ってほしい行動(After)" value={strategy.desired_action} />
            <Field label="中心メッセージ" value={strategy.main_message} />
            <Field label="独自の切り口" value={strategy.unique_angle} />
            <Field label="Threadsの役割" value={strategy.threads_role} />
            <Field label="無料noteの役割" value={strategy.free_note_role} />
            {strategy.paid_note_role && <Field label="有料noteの役割" value={strategy.paid_note_role} />}
            <Field label="CTA戦略" value={strategy.cta_strategy} />
          </CardContent>
        </Card>
      )}

      {threadsPosts.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-neutral-900">Threads 5案</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {threadsPosts.map((post) => (
              <ThreadsPostCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      )}

      {articles.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-neutral-900">note</h2>
          <div className="grid gap-3">
            {articles.map((article) => (
              <Link key={article.id} href={`${GROWTH_OS_NOTE_ROUTE}/${article.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-900">{article.title || "(企画中)"}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {article.type === "PAID" ? `有料note(¥${article.price ?? "未設定"})` : "無料note"} ・{" "}
                        {NOTE_ARTICLE_STATUS_LABELS[article.status]}
                        {article.status === "OUTLINE" && " ・ 承認待ち"}
                      </p>
                    </div>
                    <StatusBadge status={article.status} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">{label}</p>
      <p className="text-neutral-700">{value}</p>
    </div>
  );
}
