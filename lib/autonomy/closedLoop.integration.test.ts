/**
 * 2-Cycle Closed Loop integration test (spec §13/CHANGE 8) — PHASE 1 is not
 * considered proven by a single successful execution. This reproduces the
 * exact two-cycle script the authorized plan describes:
 *
 * Cycle 1: Objective (KPI gap on a real project) -> ObjectiveObserver ->
 *   SkillCandidateResolver -> CompanyPlanner decides CREATE_WORK ->
 *   AuthorityEngine AUTO -> Execution Adapter calls the (mocked)
 *   measurement_graph -> ResultVerifier PASS -> ImpactAssessor
 *   DIRECT_KPI_CHANGE -> CompanySupervisor sees the objective still AT_RISK
 *   (deliberately, for the test) -> NEXT_CYCLE.
 *
 * Cycle 2: a genuinely new autonomy_cycles row (cycle_number=2, chained via
 * parent_cycle_id) -> ObjectiveObserver runs again -> CompanyPlanner reaches
 * a DIFFERENT decision than Cycle 1 (WAIT) with the reasoning visible in
 * decision_logs -> no execution happens this cycle -> CompanySupervisor
 * COMPLETEs the objective's loop, and the test asserts this is a
 * *successful*, not failed, outcome.
 *
 * Per the plan's stated technique, the two cycles' decisions are driven by
 * two distinct scripted LLM responses (ASSISTED mode with a mocked fetch —
 * the actual codepath does not offer a way to inject a custom Mock
 * responder into planForCycle, since Mock is always its own deterministic,
 * DB-state-driven logic; scripting the *real* provider's HTTP layer is the
 * equivalent, fully faithful way to control what each cycle's Planner call
 * returns).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";

vi.mock("@/lib/langgraph/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/langgraph/orchestrator")>();
  return { ...actual, runBusinessGraph: vi.fn() };
});

import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { runObjectiveCycle } from "@/lib/autonomy/cycleRunner";

const TENANT = "t1";
const SKILL_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function anthropicResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(body) }] }) };
}

describe("2-Cycle Closed Loop (spec §13)", () => {
  beforeEach(() => {
    vi.mocked(runBusinessGraph).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Cycle 1 CREATE_WORKs and requests NEXT_CYCLE; Cycle 2 reaches a different decision (WAIT) and COMPLETEs — both traceable via distinct decision_logs", async () => {
    const fake = new FakeSupabase();
    fake.table("tenant_autonomy_settings").push({
      tenant_id: TENANT,
      feature_enabled: true,
      autonomy_mode: "ASSISTED",
      emergency_stop: false,
      max_works_per_cycle: 1,
      max_cycles_per_objective_per_day: 4,
      max_replans_per_cycle: 1,
      cooldown_after_execution_minutes: 0,
      execution_timeout_seconds: 300,
    });
    fake.table("objectives").push({
      id: "obj-1",
      tenant_id: TENANT,
      title: "CVR改善",
      objective_type: "kpi_target",
      status: "AT_RISK",
      start_date: null,
      deadline: null,
      project_id: PROJECT_ID,
    });
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
    });
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

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // ---- Cycle 1: Planner decides CREATE_WORK ----
    fetchMock.mockResolvedValueOnce(
      anthropicResponse({
        decision: "CREATE_WORK",
        reasoningSummary: "KPI is materially off target; measurement_graph can refresh it before any further judgment.",
        confidence: 0.6,
        recommendedNextObservationAt: "2026-02-01T06:00:00Z",
        proposedWorks: [{ title: "Refresh CVR measurement", skillDefinitionId: SKILL_ID, priority: "high", estimatedCost: 0 }],
      })
    );
    vi.mocked(runBusinessGraph).mockResolvedValueOnce({ status: "completed" });
    // What the (mocked) measurement_graph would have written for this run.
    fake.table("kpi_snapshots").push({ id: "snap-1", tenant_id: TENANT, kpi_id: "kpi-1", project_id: PROJECT_ID, snapshot_type: "CURRENT", value: 0.02, created_at: "2026-02-01T00:05:00Z" });

    const cycle1 = await runObjectiveCycle(fake as unknown as never, TENANT, "obj-1", {
      now: new Date("2026-02-01T00:00:00Z"),
      llmOptions: { apiKeyOverride: "sk-test" },
    });

    expect(cycle1.skipped).toBe(false);
    expect(fake.table("autonomy_cycles")).toHaveLength(1);
    expect(fake.table("autonomy_cycles")[0].cycle_number).toBe(1);
    expect(fake.table("autonomy_cycles")[0].status).toBe("COMPLETED");

    const cycle1Plan = fake.table("plan_proposals").find((p) => p.cycle_id === cycle1.cycleId);
    expect(cycle1Plan?.decision).toBe("CREATE_WORK");

    expect(fake.table("works")).toHaveLength(1);
    expect(fake.table("works")[0].authority_decision).toBe("AUTO");
    expect(fake.table("works")[0].status).toBe("COMPLETED");

    expect(fake.table("verifications")).toHaveLength(1);
    expect(fake.table("verifications")[0].verdict).toBe("PASS");

    expect(fake.table("impact_assessments")).toHaveLength(1);
    expect(fake.table("impact_assessments")[0].classification).toBe("DIRECT_KPI_CHANGE");

    // Objective is still AT_RISK (Observer only re-evaluates it on its *next*
    // pass) — this is exactly what makes NEXT_CYCLE meaningful here.
    expect(fake.table("objectives")[0].status).toBe("AT_RISK");
    expect(cycle1.supervisorDecision).toBe("NEXT_CYCLE");

    const cycle1SuperviseLog = fake.table("decision_logs").find((r) => r.cycle_id === cycle1.cycleId && r.stage === "SUPERVISE");
    expect(cycle1SuperviseLog?.action).toBe("NEXT_CYCLE");

    // ---- Cycle 2: Planner reaches a DIFFERENT decision (WAIT) ----
    fetchMock.mockResolvedValueOnce(
      anthropicResponse({
        decision: "WAIT",
        reasoningSummary: "The metric moved in the right direction after Cycle 1's execution; waiting one more observation window before acting again.",
        confidence: 0.7,
        recommendedNextObservationAt: "2026-02-02T00:00:00Z",
      })
    );

    const cycle2 = await runObjectiveCycle(fake as unknown as never, TENANT, "obj-1", {
      now: new Date("2026-02-01T02:00:00Z"),
      llmOptions: { apiKeyOverride: "sk-test" },
    });

    expect(cycle2.skipped).toBe(false);
    expect(cycle2.cycleId).not.toBe(cycle1.cycleId);

    // A genuinely new autonomy_cycles row, chained to Cycle 1 — never a reopened/looped row.
    expect(fake.table("autonomy_cycles")).toHaveLength(2);
    const cycle2Row = fake.table("autonomy_cycles").find((c) => c.id === cycle2.cycleId)!;
    expect(cycle2Row.cycle_number).toBe(2);
    expect(cycle2Row.parent_cycle_id).toBe(cycle1.cycleId);
    expect(cycle2Row.status).toBe("COMPLETED");

    const cycle2Plan = fake.table("plan_proposals").find((p) => p.cycle_id === cycle2.cycleId);
    expect(cycle2Plan?.decision).toBe("WAIT");
    expect(cycle2Plan?.decision).not.toBe(cycle1Plan?.decision);

    // No new Work/execution in Cycle 2 — WAIT means the cycle completes with no execution.
    expect(fake.table("works")).toHaveLength(1);
    expect(runBusinessGraph).toHaveBeenCalledTimes(1);

    // A successful, not failed, outcome (spec §13's explicit assertion).
    expect(cycle2.supervisorDecision).toBe("COMPLETE");
    const cycle2SuperviseLog = fake.table("decision_logs").find((r) => r.cycle_id === cycle2.cycleId && r.stage === "SUPERVISE");
    expect(cycle2SuperviseLog?.action).toBe("COMPLETE");

    // Every stage's reasoning is traceable per cycle via decision_logs' cycle_id.
    const cycle1Logs = fake.table("decision_logs").filter((r) => r.cycle_id === cycle1.cycleId);
    const cycle2Logs = fake.table("decision_logs").filter((r) => r.cycle_id === cycle2.cycleId);
    expect(cycle1Logs.map((r) => r.stage)).toEqual(expect.arrayContaining(["OBSERVE", "PLAN", "AUTHORIZE", "EXECUTE", "VERIFY", "ASSESS_IMPACT", "SUPERVISE"]));
    expect(cycle2Logs.map((r) => r.stage)).toEqual(expect.arrayContaining(["OBSERVE", "PLAN", "SUPERVISE"]));
    expect(cycle2Logs.some((r) => r.stage === "EXECUTE")).toBe(false);
  });
});
