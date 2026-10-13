export type ChannelCounts = {
  channel: string;
  impressions: number;
  applies: number;
  interviews: number;
};

export type ChannelSummary = ChannelCounts & {
  /** applies / impressions */
  applyRate: number | null;
  /** interviews / applies */
  interviewRate: number | null;
};

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export function summarize(rows: ChannelCounts[]): { channels: ChannelSummary[]; total: ChannelSummary } {
  const channels = rows.map((r) => ({
    ...r,
    applyRate: ratio(r.applies, r.impressions),
    interviewRate: ratio(r.interviews, r.applies),
  }));
  const sum = (k: "impressions" | "applies" | "interviews") => rows.reduce((acc, r) => acc + r[k], 0);
  const total = {
    channel: "合計",
    impressions: sum("impressions"),
    applies: sum("applies"),
    interviews: sum("interviews"),
    applyRate: ratio(sum("applies"), sum("impressions")),
    interviewRate: ratio(sum("interviews"), sum("applies")),
  };
  return { channels, total };
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}
