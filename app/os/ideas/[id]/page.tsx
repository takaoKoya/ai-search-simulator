import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getIdea } from "@/lib/growth-os/db/ideas";
import { listIdeaEvidence } from "@/lib/growth-os/db/ideaSources";
import { runIdeaScoreAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { ScoreBandBadge, IdeaStatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { IdeaApprovalActions } from "@/components/growth-os/dashboard/IdeaApprovalActions";
import { SecondaryChannelActions } from "@/components/growth-os/ideas/SecondaryChannelActions";
import { ScoreRadarChart } from "@/components/growth-os/ideas/ScoreRadarChart";
import { ScoreReasonTable } from "@/components/growth-os/ideas/ScoreReasonTable";
import { EvidenceList } from "@/components/growth-os/ideas/EvidenceList";
import { judgeIdea, CONFIDENCE_JUDGMENT_LABELS } from "@/lib/growth-os/confidence";
import { HARM_TYPE_LABELS } from "@/lib/growth-os/types";
import { GROWTH_OS_IDEAS_ROUTE } from "@/lib/routes";

export const metadata: Metadata = { title: "Idea detail | note Growth OS" };

export default async function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const idea = await getIdea(supabase, userId, id);
  if (!idea) notFound();

  const evidence = await listIdeaEvidence(supabase, userId, id);
  const confidence = idea.confidence_score ?? 0;
  const judgment = judgeIdea(idea.total_score, confidence);

  return (
    <div>
      <PageHeader
        title={idea.title}
        subtitle={idea.summary ?? undefined}
        actions={
          <form action={runIdeaScoreAction.bind(null, idea.id)}>
            <Button size="md" type="submit" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50">
              再スコアリング
            </Button>
          </form>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ScoreBandBadge totalScore={idea.total_score} />
        <span className="font-mono text-lg font-semibold text-neutral-900">{idea.total_score}点 / 100点</span>
        <span className="font-mono text-sm text-gray-500">信頼度 {confidence}%</span>
        <Badge variant="neutral">{CONFIDENCE_JUDGMENT_LABELS[judgment]}</Badge>
        <IdeaStatusBadge status={idea.status} />
      </div>

      {idea.most_similar_idea_id && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          類似したIdeaがあります(類似度 {Math.round((idea.duplicate_score ?? 0) * 100)}%)。
          <Link href={`${GROWTH_OS_IDEAS_ROUTE}/${idea.most_similar_idea_id}`} className="ml-1 underline">
            比較する
          </Link>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>テーマの詳細</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="ターゲット" value={idea.target_persona} />
            <Field label="Hook" value={idea.hook} />
            <Field label="切り口(Angle)" value={idea.angle} />
            <Field label="中心課題" value={idea.core_problem} />
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">HARM</p>
              <div className="flex flex-wrap gap-1">
                {idea.harm_types.length > 0 ? (
                  idea.harm_types.map((h) => (
                    <Badge key={h} variant="neutral">
                      {HARM_TYPE_LABELS[h]}
                    </Badge>
                  ))
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3 font-mono text-xs text-gray-500">
              <span>根拠件数: {idea.evidence_count}</span>
              <span>出典種類: {idea.source_count}</span>
              <span>鮮度: {idea.freshness_score ?? "-"}</span>
              <span>推奨: {idea.recommended_free_or_paid ?? "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>9軸レーダー</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreRadarChart idea={idea} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>スコア内訳(数値・理由・根拠)</CardTitle>
        </CardHeader>
        <CardContent>
          <ScoreReasonTable scoreReason={idea.score_reason} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          <EvidenceList evidence={evidence} />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>このIdeaをどうする?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <IdeaApprovalActions ideaId={idea.id} />
          {idea.status === "APPROVED" && (
            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs text-gray-400">
                承認後の展開(Threads/note本格生成は次フェーズ対象。ここではフェーズ1で実装済みのパイプラインを試験的に呼び出せます)
              </p>
              <SecondaryChannelActions ideaId={idea.id} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">{label}</p>
      <p className="text-neutral-700">{value ?? "-"}</p>
    </div>
  );
}
