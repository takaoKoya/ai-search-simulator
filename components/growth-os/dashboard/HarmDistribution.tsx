import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HARM_TYPE_LABELS, type HarmType } from "@/lib/growth-os/types";

export function HarmDistribution({ harmTypes }: { harmTypes: HarmType[][] }) {
  const counts = new Map<HarmType, number>();
  for (const harms of harmTypes) {
    for (const h of harms) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const max = Math.max(1, ...Array.from(counts.values()));
  const entries = (Object.keys(HARM_TYPE_LABELS) as HarmType[]).map((h) => ({ harm: h, count: counts.get(h) ?? 0 }));
  const total = entries.reduce((sum, e) => sum + e.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>HARM分布(全Idea)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {total === 0 && <p className="text-sm text-gray-400">まだIdeaがありません。</p>}
        {total > 0 &&
          entries.map(({ harm, count }) => (
            <div key={harm}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className="text-gray-600">{HARM_TYPE_LABELS[harm]}</span>
                <span className="font-mono text-gray-400">{count}</span>
              </div>
              <Progress value={(count / max) * 100} />
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
