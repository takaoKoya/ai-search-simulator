import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { generateMonthlyReportFile } from "@/lib/server/documentGeneration";

const DELIVERABLE_STATUSES = ["APPROVED", "CLIENT_PREVIEW"];

/**
 * Monthly Report Delivery (Growth Loop spec §55-56): the explicit Human Send
 * after internal Manager/CEO approval — never automatic on approval alone,
 * same split as project delivery (lib/server/deliveryConfirmation.ts).
 * Reuses the exact CLIENT_VISIBLE generated_files pipeline from Phase 5.
 */
export async function deliverMonthlyReport(ctx: TenantContext, reportId: string): Promise<{ fileId: string }> {
  const { supabase, tenantId, userId } = ctx;

  const { data: report, error } = await supabase.from("monthly_reports").select("id, status, reporting_cycle_id, client_visible_file_id").eq("id", reportId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!report) throw new NotFoundError("Monthly report not found");
  if (!DELIVERABLE_STATUSES.includes(report.status as string)) {
    throw new ValidationError(`Report must be APPROVED before it can be delivered (status=${report.status})`);
  }

  let fileId = report.client_visible_file_id as string | null;
  if (!fileId) {
    const generated = await generateMonthlyReportFile(ctx, reportId);
    fileId = generated.fileId;
  }

  await supabase
    .from("monthly_reports")
    .update({ status: "DELIVERED", delivered_at: new Date().toISOString(), delivered_by: userId, client_visible_file_id: fileId })
    .eq("id", reportId)
    .eq("tenant_id", tenantId);

  if (report.reporting_cycle_id) {
    await supabase.from("reporting_cycles").update({ status: "COMPLETED", completed_at: new Date().toISOString() }).eq("id", report.reporting_cycle_id as string).eq("tenant_id", tenantId);
  }

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: "report.delivered",
    message: "月次レポートを納品しました",
    payload: { monthlyReportId: reportId, fileId },
  });

  return { fileId: fileId as string };
}
