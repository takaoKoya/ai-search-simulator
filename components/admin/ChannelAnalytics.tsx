import { Card } from "@/components/ui/card";
import { formatRate, type ChannelSummary } from "@/lib/analytics/summary";

interface Props {
  title: string;
  summary: { channels: ChannelSummary[]; total: ChannelSummary };
}

/** Bars are scaled per-metric so small counts (applies) stay visible next to large ones (PV). */
function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" aria-hidden>
      <div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const METRICS = [
  { key: "impressions", label: "PV", bar: "bg-neutral-400 dark:bg-neutral-500" },
  { key: "applies", label: "応募", bar: "bg-blue-500" },
  { key: "interviews", label: "面接", bar: "bg-emerald-500" },
] as const;

export function ChannelAnalytics({ title, summary }: Props) {
  const { channels, total } = summary;
  const max = {
    impressions: Math.max(0, ...channels.map((c) => c.impressions)),
    applies: Math.max(0, ...channels.map((c) => c.applies)),
    interviews: Math.max(0, ...channels.map((c) => c.interviews)),
  };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-neutral-500">{title}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "PV", value: total.impressions.toLocaleString("ja-JP") },
          { label: "応募数", value: total.applies.toLocaleString("ja-JP") },
          { label: "応募率（応募/PV）", value: formatRate(total.applyRate) },
          { label: "面接到達率（面接/応募）", value: formatRate(total.interviewRate) },
        ].map((t) => (
          <div key={t.label} className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900">
            <dt className="text-xs text-neutral-500">{t.label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">{t.value}</dd>
          </div>
        ))}
      </dl>

      {channels.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">まだ計測データがありません。計測リンクから流入があるとここに表示されます。</p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-4">
            {channels.map((c) => (
              <li key={c.channel} className="flex flex-col gap-1">
                <p className="text-sm font-medium">{c.channel}</p>
                {METRICS.map((m) => (
                  <div key={m.key} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-neutral-500">{m.label}</span>
                    <Bar value={c[m.key]} max={max[m.key]} className={m.bar} />
                    <span className="w-12 text-right tabular-nums">{c[m.key].toLocaleString("ja-JP")}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">チャネル</th>
                  <th className="py-2 pr-4 text-right">PV</th>
                  <th className="py-2 pr-4 text-right">応募</th>
                  <th className="py-2 pr-4 text-right">応募率</th>
                  <th className="py-2 pr-4 text-right">面接</th>
                  <th className="py-2 text-right">面接到達率</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...channels, total].map((c) => (
                  <tr key={c.channel} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-2 pr-4 font-medium">{c.channel}</td>
                    <td className="py-2 pr-4 text-right">{c.impressions.toLocaleString("ja-JP")}</td>
                    <td className="py-2 pr-4 text-right">{c.applies.toLocaleString("ja-JP")}</td>
                    <td className="py-2 pr-4 text-right">{formatRate(c.applyRate)}</td>
                    <td className="py-2 pr-4 text-right">{c.interviews.toLocaleString("ja-JP")}</td>
                    <td className="py-2 text-right">{formatRate(c.interviewRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
