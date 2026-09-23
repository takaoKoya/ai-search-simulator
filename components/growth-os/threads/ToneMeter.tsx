import { Progress } from "@/components/ui/progress";
import type { ThreadsToneScores } from "@/lib/growth-os/types";

const AXES: { key: keyof ThreadsToneScores; label: string; goodHigh: boolean }[] = [
  { key: "empathy", label: "共感性", goodHigh: true },
  { key: "humanity", label: "人間味", goodHigh: true },
  { key: "ai_smell", label: "AI臭", goodHigh: false },
  { key: "sales_smell", label: "売り込み臭", goodHigh: false },
  { key: "preachy", label: "説教臭", goodHigh: false },
  { key: "hype", label: "過剰煽り", goodHigh: false },
];

export function ToneMeter({ scores }: { scores: ThreadsToneScores }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {AXES.map(({ key, label, goodHigh }) => (
        <div key={key}>
          <div className="mb-0.5 flex items-center justify-between text-xs">
            <span className="text-gray-500">{label}</span>
            <span className="font-mono text-gray-400">{scores[key]}</span>
          </div>
          <Progress value={scores[key]} barClassName={goodHigh ? "bg-emerald-600" : "bg-amber-500"} />
        </div>
      ))}
    </div>
  );
}
