import { Badge } from "@/components/ui/badge";
import type { AiReview } from "@/lib/growth-os/types";

const AGENT_LABELS: Record<string, string> = {
  RESEARCH_AGENT: "Research Agent",
  PLANNING_AGENT: "企画編集Agent",
  WRITER_AGENT: "Writer Agent",
  READER_50S_AGENT: "50代読者Agent",
  CHIEF_EDITOR_AGENT: "辛口編集長Agent",
  FACT_CHECK_AGENT: "Fact Check Agent",
  SALES_EDITOR_AGENT: "Sales Editor Agent",
};

const VERDICT_VARIANT = { PASS: "success", NEEDS_REVISION: "warning", FAIL: "critical" } as const;

export function AgentReviewPanel({ reviews }: { reviews: AiReview[] }) {
  const rounds = Array.from(new Set(reviews.map((r) => r.revision_number))).sort((a, b) => b - a);

  if (reviews.length === 0) {
    return <p className="text-sm text-gray-400">まだAIレビューがありません。</p>;
  }

  return (
    <div className="space-y-6">
      {rounds.map((round) => (
        <div key={round}>
          <p className="mb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase">
            {round === 0 ? "初回" : `修正${round}回目`}
          </p>
          <div className="space-y-3">
            {reviews
              .filter((r) => r.revision_number === round)
              .map((review) => (
                <div key={review.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-900">
                      {AGENT_LABELS[review.agent_type] ?? review.agent_type}
                    </span>
                    <div className="flex items-center gap-2">
                      {review.score !== null && <span className="font-mono text-xs text-gray-400">{review.score}点</span>}
                      {review.verdict && <Badge variant={VERDICT_VARIANT[review.verdict]}>{review.verdict}</Badge>}
                    </div>
                  </div>
                  {review.feedback && <p className="text-sm whitespace-pre-wrap text-gray-600">{review.feedback}</p>}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
