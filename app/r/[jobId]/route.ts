import { NextResponse } from "next/server";
import { buildApplyText, buildLineEntryUrl, resolveChannelType } from "@/lib/analytics/channel";
import { ensureChannel, recordEventSafe } from "@/lib/analytics/record";
import { prisma } from "@/lib/db";

/**
 * Public tracking link: /r/{jobId}?utm_source=tiktok
 * Counts a page view for the resolved channel, then sends the visitor to the
 * LINE official account with the apply text pre-filled. That text carries the
 * job and channel, so the webhook can attribute the application.
 */
export async function GET(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const basicId = process.env.LINE_OA_BASIC_ID;
  if (!basicId) {
    return NextResponse.json({ error: "LINE_OA_BASIC_ID is not set" }, { status: 503 });
  }

  const job = await prisma.job.findFirst({ where: { id: jobId, status: "PUBLISHED" }, select: { id: true } });
  if (!job) return NextResponse.json({ error: "求人が見つかりません" }, { status: 404 });

  const channelType = resolveChannelType(new URL(request.url).searchParams.get("utm_source"));
  const channel = await ensureChannel(job.id, channelType);
  await recordEventSafe(job.id, channel.id, "impressions");

  return NextResponse.redirect(buildLineEntryUrl(basicId, buildApplyText(job.id, channelType)), 302);
}
