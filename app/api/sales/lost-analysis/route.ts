import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";

const LOOKBACK = 30;

/**
 * Lost Analysis (spec §58): a plain aggregation over human-recorded
 * `lost_reason` values — there is no AI "guessing" here at all, only
 * counting, so the spec's "AI推測と確定理由を分離" requirement is met
 * trivially: every reason behind these percentages was entered by a human
 * on `POST /api/opportunities/[id]/lost`.
 */
export async function GET() {
  return withRoute(async () => {
    const { supabase, tenantId } = await getTenantContext();
    const { data, error } = await supabase
      .from("opportunities")
      .select("lost_reason")
      .eq("tenant_id", tenantId)
      .eq("stage", "LOST")
      .order("updated_at", { ascending: false })
      .limit(LOOKBACK);
    if (error) throw error;

    const rows = data ?? [];
    const counts = new Map<string, number>();
    for (const row of rows) {
      const reason = (row.lost_reason as string | null) ?? "unknown";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    const breakdown = Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count, percentage: rows.length > 0 ? Math.round((count / rows.length) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count);

    return { lookback: LOOKBACK, totalLost: rows.length, breakdown };
  });
}
