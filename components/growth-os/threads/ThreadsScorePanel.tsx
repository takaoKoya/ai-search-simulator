import { Progress } from "@/components/ui/progress";
import { THREADS_QUALITY_BAR, meetsThreadsQualityBar, type ThreadsPost, type ThreadsScoreReasonEntry } from "@/lib/growth-os/types";

const AXES: { key: keyof ThreadsPost; label: string; goodHigh: boolean }[] = [
  { key: "hook_score", label: "Hook", goodHigh: true },
  { key: "empathy_score", label: "共感性", goodHigh: true },
  { key: "humanity_score", label: "人間味", goodHigh: true },
  { key: "clarity_score", label: "明瞭さ", goodHigh: true },
  { key: "shareability_score", label: "拡散性", goodHigh: true },
  { key: "sales_smell_score", label: "売り込み臭", goodHigh: false },
  { key: "ai_smell_score", label: "AI臭", goodHigh: false },
  { key: "preachiness_score", label: "説教臭", goodHigh: false },
  { key: "fear_score", label: "不安煽り", goodHigh: false },
];

export function ThreadsScorePanel({ post }: { post: ThreadsPost }) {
  if (post.overall_score === null) {
    return <p className="text-xs text-gray-400">評価待ちです。</p>;
  }

  const meets = meetsThreadsQualityBar(post);
  const reasonByCriterion = new Map(post.score_reason.map((r) => [r.criterion, r.reason]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-900">
          総合スコア <span className="font-mono">{post.overall_score}</span>点
          <span className="ml-1 text-xs font-normal text-gray-400">(基準 {THREADS_QUALITY_BAR.overall_score}点)</span>
        </span>
        {meets ? (
          <span className="text-xs font-semibold text-emerald-600">公開品質基準クリア</span>
        ) : (
          <span className="text-xs font-semibold text-amber-600">
            基準未達{post.rewrite_count > 0 ? `(リライト${post.rewrite_count}回目)` : ""}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {AXES.map(({ key, label, goodHigh }) => {
          const score = (post[key] as number | null) ?? 0;
          const criterion = key.replace("_score", "") as ThreadsScoreReasonEntry["criterion"];
          return (
            <div key={key} title={reasonByCriterion.get(criterion)}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className="text-gray-500">{label}</span>
                <span className="font-mono text-gray-400">{score}</span>
              </div>
              <Progress value={score} barClassName={goodHigh ? "bg-emerald-600" : "bg-amber-500"} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
