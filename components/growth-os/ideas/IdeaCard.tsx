import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreBandBadge, IdeaStatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { HARM_TYPE_LABELS, RECOMMENDED_FORMAT_LABELS, type ContentIdea } from "@/lib/growth-os/types";
import { GROWTH_OS_IDEAS_ROUTE } from "@/lib/routes";

export function IdeaCard({ idea }: { idea: ContentIdea }) {
  return (
    <Link href={`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-3 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <ScoreBandBadge totalScore={idea.total_score} />
            <IdeaStatusBadge status={idea.status} />
            {idea.most_similar_idea_id && <Badge variant="warning">類似Ideaあり</Badge>}
          </div>

          <div>
            <p className="font-semibold text-neutral-900">{idea.title}</p>
            {idea.hook && <p className="mt-1 text-sm text-gray-500">{idea.hook}</p>}
          </div>

          {idea.target_persona && <p className="text-xs text-gray-400">対象: {idea.target_persona}</p>}

          <div className="flex flex-wrap gap-1">
            {idea.harm_types.map((h) => (
              <Badge key={h} variant="neutral">
                {HARM_TYPE_LABELS[h]}
              </Badge>
            ))}
          </div>

          <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-3 font-mono text-xs text-gray-500">
            <span>Score {idea.total_score}</span>
            <span>Confidence {idea.confidence_score ?? "-"}</span>
            <span>Trend {idea.trend_score ?? "-"}</span>
            <span>Pain {idea.pain_score ?? "-"}</span>
            <span>Competition {idea.competition_opportunity_score ?? "-"}</span>
            <span>{idea.recommended_free_or_paid ?? "-"}</span>
          </div>

          {idea.recommended_format && (
            <p className="text-xs text-gray-400">推奨: {RECOMMENDED_FORMAT_LABELS[idea.recommended_format]}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
