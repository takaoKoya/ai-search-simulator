import { prisma } from "@/lib/db";
import { CHANNEL_LABELS } from "./channel";
import type { Period } from "./period";
import { summarize } from "./summary";

/** Per-channel funnel totals, optionally limited to one job and/or a date range. */
export async function getChannelSummary(jobId?: string, period?: Period) {
  const date = period && (period.start || period.end) ? { gte: period.start ?? undefined, lte: period.end ?? undefined } : undefined;
  const [grouped, channels] = await Promise.all([
    prisma.analytics.groupBy({
      by: ["channelId"],
      where: { ...(jobId ? { jobId } : {}), ...(date ? { date } : {}) },
      _sum: { impressions: true, applies: true, interviews: true },
    }),
    prisma.channel.findMany({ where: jobId ? { jobId } : undefined, select: { id: true, type: true } }),
  ]);
  const typeById = new Map(channels.map((c) => [c.id, c.type]));

  // Several jobs each have their own channel row per type; merge them by type.
  const byType = new Map<string, { channel: string; impressions: number; applies: number; interviews: number }>();
  for (const g of grouped) {
    const type = typeById.get(g.channelId);
    if (!type) continue;
    const row = byType.get(type) ?? { channel: CHANNEL_LABELS[type], impressions: 0, applies: 0, interviews: 0 };
    row.impressions += g._sum.impressions ?? 0;
    row.applies += g._sum.applies ?? 0;
    row.interviews += g._sum.interviews ?? 0;
    byType.set(type, row);
  }
  const rows = [...byType.values()].sort((a, b) => b.impressions + b.applies - (a.impressions + a.applies));
  return summarize(rows);
}
