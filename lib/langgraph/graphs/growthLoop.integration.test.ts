import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { decideApproval } from "@/lib/server/approvals";
import { confirmProjectDelivery } from "@/lib/server/deliveryConfirmation";
import { deliverMonthlyReport } from "@/lib/server/reportDelivery";
import { recordManualKpiValue } from "@/lib/server/manualKpi";
import type { TenantContext } from "@/lib/server/tenant";

function seedAgents(fake: FakeSupabase, tenantId: string) {
  const codes = ["mina", "kuro", "qa", "repo", "renewal", "upsell", "taku"];
  for (const code of codes) {
    fake.table("agents").push({ id: `agent-${tenantId}-${code}`, tenant_id: tenantId, code, name: code, role: code, provider: "template", model: null, status: "idle", capabilities: [], is_active: true });
  }
}

function makeCtx(fake: FakeSupabase, tenantId: string, userId = "user-1", role: TenantContext["role"] = "owner"): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId, userEmail: null, role };
}

/**
 * Phase 7 vertical slice (spec §164): a single架空 company's project rides
 * the entire Growth Loop — READY_FOR_DELIVERY -> Human Delivery -> DELIVERED
 * -> Measurement Plan -> Baseline -> Manual current KPI -> Effect Evaluation
 * (Test Case A: PARTIAL_SUCCESS) -> Monthly Report Draft -> Critic -> QA ->
 * Manager+CEO Approval -> Client Preview data -> Human Delivery of the
 * report -> Renewal Due detection -> Account Health -> Upsell Detection ->
 * Critic -> Manager+CEO Approval -> Opportunity Conversion — against the
 * fake in-memory Supabase, no live network/DB required.
 */
describe("Phase 7 vertical slice: Delivery -> Measurement -> Report -> Renewal -> Upsell -> Opportunity", () => {
  it("carries one project through the full Growth Loop", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-growth";
    seedAgents(fake, tenantId);

    fake.table("approval_policies").push(
      { id: "pol-delivery", tenant_id: tenantId, code: "delivery", conditions: {}, steps: [{ role: "manager" }, { role: "ceo" }], is_active: true },
      { id: "pol-report", tenant_id: tenantId, code: "monthly_report", conditions: {}, steps: [{ role: "manager" }, { role: "ceo" }], is_active: true },
      { id: "pol-upsell", tenant_id: tenantId, code: "upsell_opportunity", conditions: {}, steps: [{ role: "manager" }, { role: "ceo" }], is_active: true }
    );

    const { data: client } = await fake.from("clients").insert({ tenant_id: tenantId, name: "架空株式会社", industry: "小売" }).select("id").single();
    const clientId = (client as { id: string }).id;

    const { data: lead } = await fake.from("leads").insert({ tenant_id: tenantId, company_name: "架空株式会社", status: "won" }).select("id").single();
    const { data: opportunity } = await fake
      .from("opportunities")
      .insert({ tenant_id: tenantId, lead_id: (lead as { id: string }).id, client_id: clientId, stage: "WON", services: [{ service: "SEO", reason: "自然検索改善" }] })
      .select("id")
      .single();
    const opportunityId = (opportunity as { id: string }).id;

    const sixtyDaysOut = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const { data: contract } = await fake
      .from("contracts")
      .insert({ tenant_id: tenantId, opportunity_id: opportunityId, status: "approved", end_date: sixtyDaysOut, notice_period_days: 30 })
      .select("id")
      .single();
    const contractId = (contract as { id: string }).id;

    const { data: project } = await fake
      .from("projects")
      .insert({ tenant_id: tenantId, client_id: clientId, contract_id: contractId, name: "架空株式会社 SEO+AIOプロジェクト", status: "ready_for_delivery" })
      .select("id")
      .single();
    const projectId = (project as { id: string }).id;

    await fake.from("deliverables").insert({ tenant_id: tenantId, project_id: projectId, title: "SEO初期施策レポート", status: "approved" });

    const { data: kpi } = await fake
      .from("kpis")
      .insert({ tenant_id: tenantId, project_id: projectId, name: "Organic CV", current_value: 10, target_value: 20, unit: "件", direction: "HIGHER_IS_BETTER", source: "manual", initiative_type: "seo" })
      .select("id")
      .single();
    const kpiId = (kpi as { id: string }).id;

    const ctx = makeCtx(fake, tenantId);
    const managerCtx = makeCtx(fake, tenantId, "user-manager", "manager");
    const ceoCtx = makeCtx(fake, tenantId, "user-ceo", "ceo");

    // 1. Human Delivery: READY_FOR_DELIVERY -> DELIVERED, Baseline Snapshot captured, Growth Loop kicked off.
    const delivery = await confirmProjectDelivery(ctx, projectId, { deliveryChannel: "email", recipient: "client@example.com" });
    expect(delivery.deliveryRecordId).toBeTruthy();
    expect(fake.table("projects").find((p) => p.id === projectId)!.status).toBe("delivered");
    expect(fake.table("deliverables").find((d) => d.project_id === projectId)!.status).toBe("delivered");

    const baselineSnapshot = fake.table("kpi_snapshots").find((s) => s.kpi_id === kpiId && s.snapshot_type === "BASELINE")!;
    expect(baselineSnapshot.value).toBe(10);

    const plan = fake.table("measurement_plans").find((p) => p.kpi_id === kpiId)!;
    // "seo" initiative -> 14 day delay -> not evaluable the instant delivery happens.
    expect(plan.status).toBe("WAITING");

    // 2. Manual current KPI input (spec §127-128): 10 -> 17 (Test Case A).
    await recordManualKpiValue(ctx, kpiId, { value: 17, reason: "月次実績を反映" });
    expect(fake.table("kpi_snapshots").filter((s) => s.kpi_id === kpiId && s.source === "manual").length).toBeGreaterThan(0);

    // Simulate "14 days have elapsed" by backdating the plan's start_at, then
    // let the scheduler-equivalent measurement_graph run pick it up.
    plan.start_at = new Date(Date.now() - 86_400_000).toISOString();

    const measurementResult = await runBusinessGraph({ supabase: ctx.supabase, tenantId, graphName: "measurement_graph", subjectType: "project", subjectId: projectId, input: { projectId } });
    expect(measurementResult.status).toBe("waiting_human");

    const completedPlan = fake.table("measurement_plans").find((p) => p.kpi_id === kpiId)!;
    expect(completedPlan.status).toBe("COMPLETED");
    expect((completedPlan.latest_evaluation as { evaluation: string }).evaluation).toBe("PARTIAL_SUCCESS");

    const currentSnapshot = fake.table("kpi_snapshots").find((s) => s.kpi_id === kpiId && s.snapshot_type === "CURRENT")!;
    expect(currentSnapshot.value).toBe(17);

    // 3. Monthly Report Draft -> Critic -> QA -> Manager/CEO Approval requested.
    const report = fake.table("monthly_reports").find((r) => r.project_id === projectId)!;
    expect(report.status).toBe("MANAGER_REVIEW");
    const reportApproval = fake.table("approval_requests").find((a) => a.type === "monthly_report")!;
    expect(reportApproval.status).toBe("pending");
    expect((reportApproval.steps as Array<{ role: string }>).map((s) => s.role)).toEqual(["manager", "ceo"]);

    const cycle = fake.table("reporting_cycles").find((c) => c.project_id === projectId)!;
    expect(cycle.status).toBe("INTERNAL_REVIEW");

    // 4. Manager then CEO approve the report.
    const managerStep = await decideApproval(managerCtx, reportApproval.id as string, "approve");
    expect(managerStep.status).toBe("pending");
    const ceoStep = await decideApproval(ceoCtx, reportApproval.id as string, "approve");
    expect(ceoStep.status).toBe("approved");
    expect(fake.table("monthly_reports").find((r) => r.id === report.id)!.status).toBe("APPROVED");

    // 5. Client Preview data is client-safe (no critic/QA notes leak into content_json).
    const contentJson = fake.table("monthly_reports").find((r) => r.id === report.id)!.content_json as { companyName: string; kpiTable: unknown[] };
    expect(contentJson.companyName).toBe("架空株式会社");
    expect(JSON.stringify(contentJson)).not.toContain("Critic");

    // 6. Human Delivery of the report: APPROVED -> DELIVERED, CLIENT_VISIBLE PDF generated.
    const delivered = await deliverMonthlyReport(ctx, report.id as string);
    expect(delivered.fileId).toBeTruthy();
    const reportFile = fake.table("generated_files").find((f) => f.id === delivered.fileId)!;
    expect(reportFile.classification).toBe("CLIENT_VISIBLE");
    expect(reportFile.entity_type).toBe("monthly_report");
    expect(fake.table("monthly_reports").find((r) => r.id === report.id)!.status).toBe("DELIVERED");
    expect(fake.table("reporting_cycles").find((c) => c.id === cycle.id)!.status).toBe("COMPLETED");

    // 7. Renewal Due detection (Test Case D: 60 days out, within the 90-day trigger) + Account Health + Upsell Detection.
    const renewalResult = await runBusinessGraph({ supabase: ctx.supabase, tenantId, graphName: "renewal_graph", subjectType: "project", subjectId: projectId, input: { projectId, companyName: "架空株式会社" } });
    expect(renewalResult.status).toBe("waiting_human");

    const renewal = fake.table("contract_renewals").find((r) => r.contract_id === contractId)!;
    expect(renewal.status).toBe("UPCOMING");
    expect(["GREEN", "YELLOW", "RED"]).toContain(renewal.risk_level);

    // 8. Upsell candidate detected (CRO — not already in the SEO-only contract scope) -> Critic passes -> Approval requested.
    const upsell = fake.table("upsell_opportunities").find((u) => u.client_id === clientId)!;
    expect(upsell.recommended_service).toBe("CRO");
    expect(upsell.status).toBe("APPROVAL_PENDING");
    const upsellApproval = fake.table("approval_requests").find((a) => a.type === "upsell_opportunity")!;
    expect(upsellApproval.status).toBe("pending");
    expect((upsellApproval.steps as Array<{ role: string }>).map((s) => s.role)).toEqual(["manager", "ceo"]);

    // 9. Manager then CEO approve the upsell -> Opportunity Conversion (spec §79).
    const upsellManagerStep = await decideApproval(managerCtx, upsellApproval.id as string, "approve");
    expect(upsellManagerStep.status).toBe("pending");
    const upsellCeoStep = await decideApproval(ceoCtx, upsellApproval.id as string, "approve");
    expect(upsellCeoStep.status).toBe("approved");

    const convertedUpsell = fake.table("upsell_opportunities").find((u) => u.id === upsell.id)!;
    expect(convertedUpsell.status).toBe("APPROVED");
    expect(convertedUpsell.converted_opportunity_id).toBeTruthy();

    const newOpportunity = fake.table("opportunities").find((o) => o.id === convertedUpsell.converted_opportunity_id)!;
    expect(newOpportunity.stage).toBe("QUALIFIED");
    expect((newOpportunity.services as Array<{ service: string }>)[0].service).toBe("CRO");
    const newLead = fake.table("leads").find((l) => l.id === newOpportunity.lead_id)!;
    expect(newLead.source).toBe("upsell_expansion");

    // Tenant isolation held across every new Growth Loop table.
    for (const table of [
      "delivery_records",
      "measurement_plans",
      "kpi_snapshots",
      "reporting_cycles",
      "monthly_reports",
      "contract_renewals",
      "upsell_opportunities",
    ]) {
      expect(fake.table(table).every((row) => row.tenant_id === tenantId)).toBe(true);
    }
  });

  it("Test Case E: an upsell recommendation already inside the contract's scope never reaches a human (Critic auto-rejects)", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-growth-e";
    seedAgents(fake, tenantId);
    fake.table("approval_policies").push({ id: "pol-upsell", tenant_id: tenantId, code: "upsell_opportunity", conditions: {}, steps: [{ role: "manager" }, { role: "ceo" }], is_active: true });

    const { data: client } = await fake.from("clients").insert({ tenant_id: tenantId, name: "既存契約株式会社" }).select("id").single();
    const clientId = (client as { id: string }).id;
    const { data: lead } = await fake.from("leads").insert({ tenant_id: tenantId, company_name: "既存契約株式会社", status: "won" }).select("id").single();
    // Contract already covers SEO — a KPI named to infer "SEO" should be rejected as in-scope, not proposed.
    const { data: opportunity } = await fake
      .from("opportunities")
      .insert({ tenant_id: tenantId, lead_id: (lead as { id: string }).id, client_id: clientId, stage: "WON", services: [{ service: "SEO", reason: "既存" }] })
      .select("id")
      .single();
    const { data: contract } = await fake.from("contracts").insert({ tenant_id: tenantId, opportunity_id: (opportunity as { id: string }).id, status: "approved" }).select("id").single();
    const { data: project } = await fake
      .from("projects")
      .insert({ tenant_id: tenantId, client_id: clientId, contract_id: (contract as { id: string }).id, name: "既存契約プロジェクト", status: "delivered" })
      .select("id")
      .single();
    const projectId = (project as { id: string }).id;

    const { data: kpi } = await fake.from("kpis").insert({ tenant_id: tenantId, project_id: projectId, name: "Organic Traffic (SEO)", target_value: 1000, direction: "HIGHER_IS_BETTER" }).select("id").single();
    const kpiId = (kpi as { id: string }).id;
    await fake.from("measurement_plans").insert({
      tenant_id: tenantId,
      project_id: projectId,
      kpi_id: kpiId,
      status: "COMPLETED",
      latest_evaluation: { evaluation: "NEGATIVE" },
    });

    const ctx = makeCtx(fake, tenantId);
    await runBusinessGraph({ supabase: ctx.supabase, tenantId, graphName: "renewal_graph", subjectType: "project", subjectId: projectId, input: { projectId, companyName: "既存契約株式会社" } });

    const upsell = fake.table("upsell_opportunities").find((u) => u.client_id === clientId)!;
    expect(upsell.status).toBe("REJECTED");
    expect(upsell.rejected_reason).toContain("Critic");
    expect(fake.table("approval_requests").filter((a) => a.type === "upsell_opportunity")).toHaveLength(0);
  });

  it("Test Case F: a human-rejected upsell records a reason and starts a cooldown", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-growth-f";
    seedAgents(fake, tenantId);

    const { data: upsell } = await fake
      .from("upsell_opportunities")
      .insert({ tenant_id: tenantId, client_id: "client-1", recommended_service: "Ads", problem: "p", status: "APPROVAL_PENDING" })
      .select("id")
      .single();
    const { data: approval } = await fake
      .from("approval_requests")
      .insert({ tenant_id: tenantId, type: "upsell_opportunity", subject_type: "upsell_opportunity", subject_id: (upsell as { id: string }).id, title: "test", status: "pending", steps: [], current_step: 0 })
      .select("id")
      .single();

    const ctx = makeCtx(fake, tenantId, "user-ceo", "ceo");
    const result = await decideApproval(ctx, (approval as { id: string }).id, "reject", "予算タイミングが合わない");
    expect(result.status).toBe("rejected");

    const rejected = fake.table("upsell_opportunities").find((u) => u.id === (upsell as { id: string }).id)!;
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejected_reason).toBe("予算タイミングが合わない");
    expect(rejected.cooldown_until).toBeTruthy();
    expect(new Date(rejected.cooldown_until as string).getTime()).toBeGreaterThan(Date.now());
  });
});
