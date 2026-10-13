import { jstDate } from "./channel";

export const PERIOD_RANGES = ["all", "today", "7d", "30d", "custom"] as const;
export type PeriodRange = (typeof PERIOD_RANGES)[number];

export const PERIOD_LABELS: Record<PeriodRange, string> = {
  all: "全期間",
  today: "今日",
  "7d": "過去7日間",
  "30d": "過去30日間",
  custom: "カスタム",
};

/** start/end are inclusive JST calendar dates (UTC-midnight Dates); null = unbounded. */
export type Period = { range: PeriodRange; start: Date | null; end: Date | null };

export type PeriodInput = { range?: string | null; startDate?: string | null; endDate?: string | null };

const DAY_MS = 24 * 3600 * 1000;

export function parseDateOnly(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  // reject overflowed dates such as 2026-02-31
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

export function formatDateOnly(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function resolvePeriod(
  input: PeriodInput,
  now: Date = new Date(),
): { ok: true; period: Period } | { ok: false; error: string } {
  const startRaw = input.startDate || null;
  const endRaw = input.endDate || null;
  // dates without an explicit range mean "custom"
  const range = (input.range || (startRaw || endRaw ? "custom" : "all")) as PeriodRange;
  if (!PERIOD_RANGES.includes(range)) return { ok: false, error: "range が不正です" };

  const today = jstDate(now);
  switch (range) {
    case "all":
      return { ok: true, period: { range, start: null, end: null } };
    case "today":
      return { ok: true, period: { range, start: today, end: today } };
    case "7d":
    case "30d": {
      const days = range === "7d" ? 7 : 30;
      return { ok: true, period: { range, start: new Date(today.getTime() - (days - 1) * DAY_MS), end: today } };
    }
    case "custom": {
      if (!startRaw && !endRaw) return { ok: false, error: "開始日または終了日を指定してください" };
      const start = startRaw ? parseDateOnly(startRaw) : null;
      const end = endRaw ? parseDateOnly(endRaw) : null;
      if ((startRaw && !start) || (endRaw && !end)) return { ok: false, error: "日付は YYYY-MM-DD 形式で指定してください" };
      if (start && end && start > end) return { ok: false, error: "開始日は終了日以前にしてください" };
      return { ok: true, period: { range, start, end } };
    }
  }
}
