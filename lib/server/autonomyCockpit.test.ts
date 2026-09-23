import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { getAutonomyCockpitState } from "@/lib/server/autonomyCockpit";
import type { TenantContext } from "@/lib/server/tenant";

const TENANT = "t1";

function makeCtx(fake: FakeSupabase): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId: TENANT, userId: "user-1", userEmail: null, role: "owner" };
}

describe("getAutonomyCockpitState", () => {
  it("returns settings/costToday as null and an empty objectives list when nothing is seeded", async () => {
    const fake = new FakeSupabase();
    const state = await getAutonomyCockpitState(makeCtx(fake));
    expect(state.settings).toBeNull();
    expect(state.costToday).toBeNull();
    expect(state.objectives).toEqual([]);
  });

  it("aggregates the full pipeline trail for one objective: KPI, cycle, plan, work, verification, impact, supervisor decision, cost", async () => {
    const fake = new FakeSupabase();
    fake.table("tenant_autonomy_settings").push({
      tenant_id: TENANT,
      feature_enabled: true,
      autonomy_mode: "ASSISTED",
      emergency_stop: false,
      daily_cost_limit_usd: 10,
    });
    fake.table("objectives").push({ id: "obj-1", tenant_id: TENANT, title: "CVR改善", status: "AT_RISK", target_value: 0.05, current_value: 0.01, unit: "ratio", created_at: "2026-01-01" });
    fake.table("kpis").push({ id: "kpi-1", tenant_id: TENANT, objective_id: "obj-1", name: "CVR", current_value: 0.02, target_value: 0.05, created_at: "2026-01-01T00:00:00Z" });
    fake.table("autonomy_cycles").push({ id: "cyc-1", tenant_id: TENANT, objective_id: "obj-1", cycle_number: 1, status: "COMPLETED" });
    fake.table("plan_proposals").push({ id: "pp-1", tenant_id: TENANT, cycle_id: "cyc-1", decision: "CREATE_WORK", reasoning_summary: "KPI off target", provider_kind: "REAL", created_at: "2026-02-01T00:00:00Z" });
    fake.table("works").push({ id: "work-1", tenant_id: TENANT, cycle_id: "cyc-1", title: "Refresh CVR measurement", status: "COMPLETED", authority_decision: "AUTO", created_at: "2026-02-01T00:01:00Z" });
    fake.table("verifications").push({ id: "ver-1", tenant_id: TENANT, work_id: "work-1", verdict: "PASS", created_at: "2026-02-01T00:02:00Z" });
    fake.table("impact_assessments").push({ id: "imp-1", tenant_id: TENANT, work_id: "work-1", classification: "DIRECT_KPI_CHANGE", created_at: "2026-02-01T00:03:00Z" });
    fake.table("decision_logs").push({ id: "log-1", tenant_id: TENANT, cycle_id: "cyc-1", stage: "SUPERVISE", action: "NEXT_CYCLE", created_at: "2026-02-01T00:04:00Z" });
    fake.table("cost_ledgers").push({ id: "ledger-1", tenant_id: TENANT, ledger_date: new Date().toISOString().slice(0, 10), reserved_total_usd: 0, reconciled_total_usd: 0.05 });

    const state = await getAutonomyCockpitState(makeCtx(fake));

    expect(state.settings?.autonomy_mode).toBe("ASSISTED");
    expect(state.costToday).toEqual({ reservedUsd: 0, reconciledUsd: 0.05, dailyLimitUsd: 10 });

    expect(state.objectives).toHaveLength(1);
    const obj = state.objectives[0];
    expect(obj.title).toBe("CVR改善");
    expect(obj.kpi?.currentValue).toBe(0.02);
    expect(obj.currentCycle).toEqual({ id: "cyc-1", cycleNumber: 1, status: "COMPLETED" });
    expect(obj.latestPlan).toEqual({ decision: "CREATE_WORK", reasoningSummary: "KPI off target", providerKind: "REAL" });
    expect(obj.latestWork?.status).toBe("COMPLETED");
    expect(obj.latestVerification).toEqual({ verdict: "PASS" });
    expect(obj.latestImpact).toEqual({ classification: "DIRECT_KPI_CHANGE" });
    expect(obj.supervisorDecision).toBe("NEXT_CYCLE");
    expect(obj.pendingApproval).toBeNull();
  });

  it("surfaces a pending work_creation approval for a Work still AUTHORITY_PENDING", async () => {
    const fake = new FakeSupabase();
    fake.table("objectives").push({ id: "obj-1", tenant_id: TENANT, title: "CVR改善", status: "AT_RISK", created_at: "2026-01-01" });
    fake.table("autonomy_cycles").push({ id: "cyc-1", tenant_id: TENANT, objective_id: "obj-1", cycle_number: 1, status: "RUNNING" });
    fake.table("works").push({ id: "work-1", tenant_id: TENANT, cycle_id: "cyc-1", title: "Refresh CVR measurement", status: "AUTHORITY_PENDING", authority_decision: "APPROVAL", created_at: "2026-02-01T00:01:00Z" });
    fake.table("approval_requests").push({ id: "appr-1", tenant_id: TENANT, type: "work_creation", subject_id: "work-1", title: "Work: Refresh CVR measurement", status: "pending" });

    const state = await getAutonomyCockpitState(makeCtx(fake));

    expect(state.objectives[0].pendingApproval).toEqual({ id: "appr-1", title: "Work: Refresh CVR measurement" });
  });
});
