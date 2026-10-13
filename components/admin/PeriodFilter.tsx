"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PERIOD_LABELS, PERIOD_RANGES, type PeriodRange } from "@/lib/analytics/period";

interface Props {
  range: PeriodRange;
  startDate: string;
  endDate: string;
}

const inputClass =
  "h-9 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

/** Keeps the selected period in the URL (?range=&startDate=&endDate=) so server pages re-query. */
export function PeriodFilter({ range, startDate, endDate }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);

  function go(next: { range: PeriodRange; startDate?: string; endDate?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["range", "startDate", "endDate"]) params.delete(k);
    if (next.range !== "all") params.set("range", next.range);
    if (next.range === "custom") {
      if (next.startDate) params.set("startDate", next.startDate);
      if (next.endDate) params.set("endDate", next.endDate);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const invalid = (!start && !end) || (!!start && !!end && start > end);

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="集計期間">
      <div className="flex flex-wrap gap-2">
        {PERIOD_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => (r === "custom" ? go({ range: r, startDate: start, endDate: end }) : go({ range: r }))}
            className={`h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
              range === r
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {PERIOD_LABELS[r]}
          </button>
        ))}
      </div>
      {range === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            開始日
            <input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            終了日
            <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </label>
          <Button
            type="button"
            disabled={invalid}
            onClick={() => go({ range: "custom", startDate: start, endDate: end })}
            className="h-9 px-4 text-xs"
          >
            適用
          </Button>
        </div>
      )}
    </div>
  );
}
