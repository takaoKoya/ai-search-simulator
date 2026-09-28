import { IDEA_SCORE_CRITERIA, type IdeaScoreReasonEntry } from "@/lib/growth-os/types";

/** チャートだけでなく、数値と評価理由(reason/evidence)を必ず併記する(セクション9)。 */
export function ScoreReasonTable({ scoreReason }: { scoreReason: IdeaScoreReasonEntry[] }) {
  if (scoreReason.length === 0) {
    return <p className="text-sm text-gray-400">まだスコアリングされていません。「再スコアリング」を実行してください。</p>;
  }

  return (
    <div className="space-y-4">
      {IDEA_SCORE_CRITERIA.map((criterion) => {
        const entry = scoreReason.find((e) => e.criterion === criterion.key);
        return (
          <div key={criterion.key} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-neutral-900">{criterion.label}</span>
              <span className="font-mono text-gray-500">
                {entry?.score ?? 0} / {criterion.weight}
              </span>
            </div>
            {entry ? (
              <>
                <p className="text-sm text-gray-600">{entry.reason}</p>
                <p className="mt-0.5 text-xs text-gray-400">根拠: {entry.evidence}</p>
              </>
            ) : (
              <p className="text-xs text-gray-400">未評価</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
