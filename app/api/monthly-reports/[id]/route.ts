import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";

/**
 * Client Report Preview (spec §55): returns only client-safe fields.
 * `content_json` is already the client-facing document (no cost/margin/
 * critic notes inside it — see lib/documents/monthlyReportDocument.ts);
 * internal-only columns (critic_notes, qa_notes) are deliberately excluded
 * from this response at the API layer, not just hidden in the UI (spec §163).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: report, error } = await supabase
      .from("monthly_reports")
      .select("id, project_id, version, period_start, period_end, status, content_json, delivered_at, created_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!report) throw new NotFoundError("Monthly report not found");

    return { report };
  });
}
