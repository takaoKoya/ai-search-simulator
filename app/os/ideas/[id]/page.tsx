import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getIdea } from "@/lib/growth-os/db/ideas";
import { IDEA_SCORE_CRITERIA } from "@/lib/growth-os/types";
import { runIdeaScoreAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { TierBadge, StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { IdeaApprovalActions } from "@/components/growth-os/dashboard/IdeaApprovalActions";

export const metadata: Metadata = { title: "Idea detail | note Growth OS" };

export default async function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const idea = await getIdea(supabase, userId, id);
  if (!idea) notFound();

  return (
    <div>
      <PageHeader
        title={idea.title}
        subtitle={idea.summary ?? undefined}
        actions={
          <form action={runIdeaScoreAction.bind(null, idea.id)}>
            <Button
              size="md"
              type="submit"
              className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
            >
              再スコアリング
            </Button>
          </form>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <TierBadge tier={idea.tier} />
        <span className="font-mono text-lg font-semibold text-neutral-900">{idea.total_score}点 / 100点</span>
        <StatusBadge status={idea.status} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>スコア内訳</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {idea.score_breakdown.length === 0 ? (
            <p className="text-sm text-gray-400">まだスコアリングされていません。「再スコアリング」を実行してください。</p>
          ) : (
            IDEA_SCORE_CRITERIA.map((criterion) => {
              const entry = idea.score_breakdown.find((e) => e.criterion === criterion.key);
              return (
                <div key={criterion.key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-neutral-900">{criterion.label}</span>
                    <span className="font-mono text-gray-500">
                      {entry?.score ?? 0} / {criterion.weight}
                    </span>
                  </div>
                  <Progress value={((entry?.score ?? 0) / criterion.weight) * 100} className="mb-1" />
                  {entry?.reasoning && <p className="text-xs text-gray-400">{entry.reasoning}</p>}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>このIdeaをどうする?</CardTitle>
        </CardHeader>
        <CardContent>
          <IdeaApprovalActions ideaId={idea.id} />
        </CardContent>
      </Card>
    </div>
  );
}
