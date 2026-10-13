import { prisma } from "@/lib/db";
import type { ChannelType } from "@/lib/generated/prisma/client";
import { jstDate } from "./channel";

export type AnalyticsField = "impressions" | "applies" | "interviews";

export function ensureChannel(jobId: string, type: ChannelType) {
  return prisma.channel.upsert({
    where: { jobId_type: { jobId, type } },
    create: { jobId, type },
    update: {},
  });
}

export async function recordEvent(jobId: string, channelId: string, field: AnalyticsField): Promise<void> {
  const date = jstDate();
  await prisma.analytics.upsert({
    where: { jobId_channelId_date: { jobId, channelId, date } },
    create: { jobId, channelId, date, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
}

/** Analytics must never break the user-facing flow it observes. */
export async function recordEventSafe(jobId: string, channelId: string, field: AnalyticsField): Promise<void> {
  try {
    await recordEvent(jobId, channelId, field);
  } catch (e) {
    console.error("analytics record failed", { jobId, channelId, field }, e);
  }
}
