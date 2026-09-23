import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreBandBadge } from "@/components/growth-os/shared/StatusBadge";
import { IdeaApprovalActions } from "@/components/growth-os/dashboard/IdeaApprovalActions";
import { judgeIdea, CONFIDENCE_JUDGMENT_LABELS } from "@/lib/growth-os/confidence";
import { HARM_TYPE_LABELS } from "@/lib/growth-os/types";
import { GROWTH_OS_IDEAS_ROUTE } from "@/lib/routes";
import type { ContentIdea } from "@/lib/growth-os/types";
import { Button } from "@/components/ui/button";

/** 「今日、何をすべきか」の最優先Ideaを大きく表示するヒーローカード。 */
export function PriorityIdeaCard({ idea }: { idea: ContentIdea }) {
  const confidence = idea.confidence_score ?? 0;
  const judgment = judgeIdea(idea.total_score, confidence);
  const reasonText = idea.hook ?? idea.core_problem ?? idea.summary;

  return (
    <Card>
      <CardContent className="py-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ScoreBandBadge totalScore={idea.total_score} />
          <Badge variant="neutral">{CONFIDENCE_JUDGMENT_LABELS[judgment]}</Badge>
          {idea.harm_types.map((h) => (
            <Badge key={h} variant="neutral">
              {HARM_TYPE_LABELS[h]}
            </Badge>
          ))}
        </div>

        <h2 className="mb-2 text-xl font-bold text-neutral-900">{idea.title}</h2>

        <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="font-mono text-2xl font-semibold text-neutral-900">
            Score {idea.total_score}
            <span className="text-sm font-normal text-gray-400"> / 100</span>
          </span>
          <span className="font-mono text-lg text-gray-600">
            Confidence {confidence}
            <span className="text-sm font-normal text-gray-400">%</span>
          </span>
        </div>

        {reasonText && <p className="mb-4 text-sm text-gray-600">{reasonText}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`}>
            <Button size="md" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50">
              詳細を見る
            </Button>
          </Link>
          <IdeaApprovalActions ideaId={idea.id} />
        </div>
      </CardContent>
    </Card>
  );
}
