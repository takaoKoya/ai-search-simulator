import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";

vi.mock("@/lib/langgraph/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/langgraph/orchestrator")>();
  return { ...actual, runBusinessGraph: vi.fn() };
});

import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { runObjectiveCycle } from "@/lib/autonomy/cycleRunner";

beforeEach(() => {
  vi.mocked(runBusinessGraph).mockClear();
});

const TENANT = "t1";
const SKILL_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function seedTenant(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: TENANT,
    feature_enabled: true,
    autonomy_mode: "SHADOW",
    emergency_stop: false,
    max_works_per_cycle: 1,
    max_cycles_per_objective_per_day: 4,
    cooldown_after_execution_minutes: 0,
    max_replans_per_cycle: 1,
    execution_timeout_seconds: 300,
    ...overrides,
  });
}

function seedObjective(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("objectives").push({ id: "obj-1", tenant_id: TENANT, title: "CVR改善", status: "AT_RISK", start_date: null, deadline: null, project_id: PROJECT_ID, ...overrides });
}

function seedSkill(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("skill_definitions").push({
    id: SKILL_ID,
    tenant_id: TENANT,
    enabled: true,
    department: "production",
    risk_level: "LOW",
    executor_ref: "measurement_graph",
    name: "Measurement",
    description: null,
    approval_policy_code: null,
    ...overrides,
  });
}

const NOW = new Date("2026-02-01T00:00:00Z");

describe("runObjectiveCycle", () => {
  it("returns skipped:true (with reason) when the Observer itself skips, without creating a cycle", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { cooldown_after_execution_minutes: 60 });
    seedObjective(fake);
    fake.table("autonomy_cycles").push({
      id: "cyc-0",
      tenant_id: TENANT,
      objective_id: "obj-1",
      cycle_number: 1,
      status: "COMPLETED",
      started_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      ended_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    });

    const result = await runObjectiveCycle(fake as unknown as never, TENANT, "obj-1", { now: NOW });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("COOLDOWN");
  });

  it("completes the cycle immediately (COMPLETE, no plan_proposals row) when the observation does not require planning", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake, { status: "ACTIVE" });
    // No kpis row -> NO_KPI_LINKED -> requires_planning: false.

    const result = await runObjectiveCycle(fake as unknown as never, TENANT, "obj-1");

    expect(result.skipped).toBe(false);
    expect(result.supervisorDecision).toBe("COMPLETE");
    expect(fake.table("autonomy_cycles")[0].status).toBe("COMPLETED");
    expect(fake.table("plan_proposals")).toHaveLength(0);
  });

  it("runs the full CREATE_WORK -> AUTO -> Execute -> Verify -> Impact -> Supervise chain end to end, requesting NEXT_CYCLE while the objective is still AT_RISK", async () => {
    // SHADOW mode (used elsewhere in this file for the deterministic Mock)
    // would make the Execution Adapter itself skip execution — this test
    // needs a real, completed execution, so it uses ASSISTED with a
    // mocked Anthropic response instead, exactly like planner.test.ts's
    // "uses a real provider" case.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                decision: "CREATE_WORK",
                reasoningSummary: "KPI is off target; measurement_graph can refresh it.",
                confidence: 0.6,
                recommendedNextObservationAt: new Date().toISOString(),
                proposedWorks: [{ title: "Refresh CVR measurement", skillDefinitionId: SKILL_ID, priority: "high", estimatedCost: 0 }],
              }),
            },
          ],
        }),
      })
    );

    try {
      const fake = new FakeSupabase();
      seedTenant(fake, { autonomy_mode: "ASSISTED" });
      seedObjective(fake, { status: "AT_RISK" });
      seedSkill(fake);
      fake.table("kpis").push({
        id: "kpi-1",
        tenant_id: TENANT,
        objective_id: "obj-1",
        current_value: 0.01,
        target_value: 0.05,
        direction: "HIGHER_IS_BETTER",
        warning_threshold: 0.03,
        critical_threshold: 0.005,
        created_at: "2026-01-01T00:00:00Z",
      });
      vi.mocked(runBusinessGraph).mockResolvedValueOnce({ status: "completed" });
      // The Execution Adapter's own verification target: a fresh CURRENT kpi_snapshot for the project.
      fake.table("kpi_snapshots").push({ id: "snap-1", tenant_id: TENANT, kpi_id: "kpi-1", project_id: PROJECT_ID, snapshot_type: "CURRENT", value: 0.02, created_at: "2026-02-01T00:05:00Z" });

      const result = await runObjectiveCycle(fake as unknown as never, TENANT, "obj-1", { llmOptions: { apiKeyOverride: "sk-test" } });

      expect(result.skipped).toBe(false);
      expect(runBusinessGraph).toHaveBeenCalledWith(expect.objectContaining({ graphName: "measurement_graph", input: expect.objectContaining({ projectId: PROJECT_ID }) }));

      expect(fake.table("works")).toHaveLength(1);
      expect(fake.table("works")[0].status).toBe("COMPLETED");
      expect(fake.table("works")[0].authority_decision).toBe("AUTO");

      expect(fake.table("verifications")).toHaveLength(1);
      expect(fake.table("verifications")[0].verdict).toBe("PASS");

      expect(fake.table("impact_assessments")).toHaveLength(1);
      expect(fake.table("impact_assessments")[0].classification).toBe("DIRECT_KPI_CHANGE");

      expect(result.supervisorDecision).toBe("NEXT_CYCLE");
      expect(fake.table("autonomy_cycles")[0].status).toBe("COMPLETED");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves the cycle untouched by Supervisor when an earlier stage already transitioned it away from RUNNING (Planner's own Fail-Closed failure)", async () => {
    const fake = new FakeSupabase();
    // ASSISTED with no api key -> planForCycle's own Fail-Closed catch block
    // transitions the cycle to FAILED and throws, before Supervisor ever runs.
    seedTenant(fake, { autonomy_mode: "ASSISTED" });
    seedObjective(fake);
    seedSkill(fake);
    fake.table("kpis").push({
      id: "kpi-1",
      tenant_id: TENANT,
      objective_id: "obj-1",
      current_value: 0.01,
      target_value: 0.05,
      direction: "HIGHER_IS_BETTER",
      warning_threshold: 0.03,
      critical_threshold: 0.005,
      created_at: "2026-01-01T00:00:00Z",
    });

    const result = await runObjectiveCycle(fake as unknown as never, TENANT, "obj-1");

    expect(result.skipped).toBe(false);
    expect(fake.table("autonomy_cycles")[0].status).toBe("FAILED");
    expect(runBusinessGraph).not.toHaveBeenCalled();
    // Supervisor never got to write its own SUPERVISE decision log for this cycle.
    expect(fake.table("decision_logs").find((r) => r.stage === "SUPERVISE")).toBeUndefined();
  });
});
