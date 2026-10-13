import { NextResponse } from "next/server";
import { formatDateOnly, resolvePeriod } from "@/lib/analytics/period";
import { getChannelSummary } from "@/lib/analytics/query";

/** GET /api/analytics?jobId=&range=all|today|7d|30d|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const resolved = resolvePeriod({ range: q.get("range"), startDate: q.get("startDate"), endDate: q.get("endDate") });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const { period } = resolved;
  const summary = await getChannelSummary(q.get("jobId") || undefined, period);
  return NextResponse.json({
    period: { range: period.range, startDate: formatDateOnly(period.start), endDate: formatDateOnly(period.end) },
    ...summary,
  });
}
