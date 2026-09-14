import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError } from "@/lib/server/errors";

/**
 * Manual KPI Input (Growth Loop spec §127-128): for KPIs with no connector,
 * a human can enter the current value directly — always audited (who/when/
 * value/reason), always tagged `source: "manual"` on the resulting snapshot
 * so the UI can show a Manual badge rather than presenting it as connector
 * data.
 */
export async function recordManualKpiValue(ctx: TenantContext, kpiId: string, params: { value: number; reason?: string | null }): Promise<void> {
  const { supabase, tenantId, userId } = ctx;

  const { data: kpi, error } = await supabase.from("kpis").select("id, project_id, name, unit").eq("id", kpiId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!kpi) throw new NotFoundError("KPI not found");

  const now = new Date().toISOString();
  await supabase.from("kpis").update({ current_value: params.value, measured_at: now, source: "manual" }).eq("id", kpiId).eq("tenant_id", tenantId);

  await supabase.from("kpi_snapshots").insert({
    tenant_id: tenantId,
    kpi_id: kpiId,
    project_id: kpi.project_id,
    snapshot_type: "CUSTOM",
    period_start: now.slice(0, 10),
    period_end: now.slice(0, 10),
    value: params.value,
    unit: kpi.unit,
    source: "manual",
    data_quality: "GOOD",
    is_estimated: false,
    captured_by_user_id: userId,
  });

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: "kpi.manual_input",
    message: `${kpi.name as string}を手動入力しました: ${params.value}${params.reason ? `（理由: ${params.reason}）` : ""}`,
    payload: { kpiId, value: params.value, reason: params.reason ?? null, enteredByUserId: userId },
  });
}
