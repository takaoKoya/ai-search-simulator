import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { reviewCycle, reviewCycleOutcome, type SupervisorReviewInput } from "@/lib/autonomy/supervisor";

const TENANT = "t1";

function baseInput(overrides: Partial<SupervisorReviewInput> = {}): SupervisorReviewInput {
  return {
    objectiveStatus: "AT_RISK",
    planDecision: "CREATE_WORK",
    replanCount: 0,
    maxReplansPerCycle: 1,
    workStatuses: ["COMPLETED"],
    verificationVerdicts: ["PASS"],
    ...overrides,
  };
}

describe("reviewCycleOutcome (pure)", () => {
  it("ESCALATEs once max_replans_per_cycle is reached on a REPLAN decision", () => {
    const result = reviewCycleOutcome(baseInput({ planDecision: "REPLAN", replanCount: 1, maxReplansPerCycle: 1 }));
    expect(result.decision).toBe("ESCALATE");
  });

  it("WAITs on a REPLAN decision under the limit", () => {
    const result = reviewCycleOutcome(baseInput({ planDecision: "REPLAN", replanCount: 0, maxReplansPerCycle: 1 }));
    expect(result.decision).toBe("WAIT");
  });

  it("ESCALATEs when no plan_proposals row was found at all", () => {
    const result = reviewCycleOutcome(baseInput({ planDecision: null }));
    expect(result.decision).toBe("ESCALATE");
  });

  it("ESCALATEs when the Planner itself decided ESCALATE", () => {
    const result = reviewCycleOutcome(baseInput({ planDecision: "ESCALATE" }));
    expect(result.decision).toBe("ESCALATE");
  });

  it("COMPLETEs on NO_ACTION or WAIT, with no execution required — a successful, not failed, outcome", () => {
    expect(reviewCycleOutcome(baseInput({ planDecision: "NO_ACTION", workStatuses: [], verificationVerdicts: [] })).decision).toBe("COMPLETE");
    expect(reviewCycleOutcome(baseInput({ planDecision: "WAIT", workStatuses: [], verificationVerdicts: [] })).decision).toBe("COMPLETE");
  });

  it("ESCALATEs if CREATE_WORK was decided but no Work rows exist", () => {
    const result = reviewCycleOutcome(baseInput({ workStatuses: [], verificationVerdicts: [] }));
    expect(result.decision).toBe("ESCALATE");
  });

  it("WAITs while a Work is still PROPOSED, AUTHORITY_PENDING, or EXECUTING", () => {
    expect(reviewCycleOutcome(baseInput({ workStatuses: ["PROPOSED"], verificationVerdicts: [] })).decision).toBe("WAIT");
    expect(reviewCycleOutcome(baseInput({ workStatuses: ["AUTHORITY_PENDING"], verificationVerdicts: [] })).decision).toBe("WAIT");
    expect(reviewCycleOutcome(baseInput({ workStatuses: ["EXECUTING"], verificationVerdicts: [] })).decision).toBe("WAIT");
  });

  it("BLOCKs when a Work is BLOCKED", () => {
    const result = reviewCycleOutcome(baseInput({ workStatuses: ["BLOCKED"], verificationVerdicts: [] }));
    expect(result.decision).toBe("BLOCK");
  });

  it("ESCALATEs when a Work FAILED execution", () => {
    const result = reviewCycleOutcome(baseInput({ workStatuses: ["FAILED"], verificationVerdicts: [] }));
    expect(result.decision).toBe("ESCALATE");
  });

  it("COMPLETEs when every Work was DENIED or CANCELLED", () => {
    expect(reviewCycleOutcome(baseInput({ workStatuses: ["DENIED"], verificationVerdicts: [] })).decision).toBe("COMPLETE");
    expect(reviewCycleOutcome(baseInput({ workStatuses: ["DENIED", "CANCELLED"], verificationVerdicts: [] })).decision).toBe("COMPLETE");
  });

  it("ESCALATEs when a completed Work's Verification did not PASS", () => {
    expect(reviewCycleOutcome(baseInput({ verificationVerdicts: ["FAIL"] })).decision).toBe("ESCALATE");
    expect(reviewCycleOutcome(baseInput({ verificationVerdicts: ["ESCALATE"] })).decision).toBe("ESCALATE");
  });

  it("WAITs when a Verification requested RETRY", () => {
    expect(reviewCycleOutcome(baseInput({ verificationVerdicts: ["RETRY"] })).decision).toBe("WAIT");
  });

  it("requests NEXT_CYCLE when everything passed but the objective is still AT_RISK/DRAFT (Cycle 1's exact vertical-slice scenario)", () => {
    expect(reviewCycleOutcome(baseInput({ objectiveStatus: "AT_RISK" })).decision).toBe("NEXT_CYCLE");
    expect(reviewCycleOutcome(baseInput({ objectiveStatus: "DRAFT" })).decision).toBe("NEXT_CYCLE");
  });

  it("COMPLETEs when everything passed and the objective is healthy (ACTIVE/ACHIEVED)", () => {
    expect(reviewCycleOutcome(baseInput({ objectiveStatus: "ACTIVE" })).decision).toBe("COMPLETE");
    expect(reviewCycleOutcome(baseInput({ objectiveStatus: "ACHIEVED" })).decision).toBe("COMPLETE");
  });
});

describe("reviewCycle", () => {
  function seedTenant(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
    fake.table("tenant_autonomy_settings").push({ tenant_id: TENANT, max_replans_per_cycle: 1, ...overrides });
  }
  function seedObjective(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
    fake.table("objectives").push({ id: "obj-1", tenant_id: TENANT, title: "CVR改善", status: "AT_RISK", ...overrides });
  }
  function seedCycle(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
    fake.table("autonomy_cycles").push({ id: "cyc-1", tenant_id: TENANT, objective_id: "obj-1", cycle_number: 1, status: "RUNNING", ...overrides });
  }

  it("transitions the cycle to COMPLETED and logs the decision when the Planner decided NO_ACTION", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    fake.table("plan_proposals").push({ id: "pp-1", tenant_id: TENANT, cycle_id: "cyc-1", decision: "NO_ACTION", created_at: "2026-02-01T00:00:00Z" });

    const result = await reviewCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.decision).toBe("COMPLETE");
    expect(fake.table("autonomy_cycles")[0].status).toBe("COMPLETED");
    const log = fake.table("decision_logs").find((r) => r.stage === "SUPERVISE");
    expect(log?.action).toBe("COMPLETE");
  });

  it("transitions the cycle to ESCALATED when a Verification did not PASS", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    fake.table("plan_proposals").push({ id: "pp-1", tenant_id: TENANT, cycle_id: "cyc-1", decision: "CREATE_WORK", created_at: "2026-02-01T00:00:00Z" });
    fake.table("works").push({ id: "work-1", tenant_id: TENANT, cycle_id: "cyc-1", status: "COMPLETED" });
    fake.table("verifications").push({ id: "ver-1", tenant_id: TENANT, work_id: "work-1", verdict: "FAIL", created_at: "2026-02-01T00:00:00Z" });

    const result = await reviewCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.decision).toBe("ESCALATE");
    expect(fake.table("autonomy_cycles")[0].status).toBe("ESCALATED");
  });

  it("requests NEXT_CYCLE (still transitions this cycle to COMPLETED, never leaves it RUNNING) when the objective is still AT_RISK after a PASSed execution", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake, { status: "AT_RISK" });
    seedCycle(fake);
    fake.table("plan_proposals").push({ id: "pp-1", tenant_id: TENANT, cycle_id: "cyc-1", decision: "CREATE_WORK", created_at: "2026-02-01T00:00:00Z" });
    fake.table("works").push({ id: "work-1", tenant_id: TENANT, cycle_id: "cyc-1", status: "COMPLETED" });
    fake.table("verifications").push({ id: "ver-1", tenant_id: TENANT, work_id: "work-1", verdict: "PASS", created_at: "2026-02-01T00:00:00Z" });

    const result = await reviewCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.decision).toBe("NEXT_CYCLE");
    expect(fake.table("autonomy_cycles")[0].status).toBe("COMPLETED");
  });

  it("leaves the cycle RUNNING (no transition at all) on WAIT", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    fake.table("plan_proposals").push({ id: "pp-1", tenant_id: TENANT, cycle_id: "cyc-1", decision: "CREATE_WORK", created_at: "2026-02-01T00:00:00Z" });
    fake.table("works").push({ id: "work-1", tenant_id: TENANT, cycle_id: "cyc-1", status: "EXECUTING" });

    const result = await reviewCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.decision).toBe("WAIT");
    expect(fake.table("autonomy_cycles")[0].status).toBe("RUNNING");
  });

  it("emits a supervisor.replan_requested agent_events row on a REPLAN-driven WAIT", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { max_replans_per_cycle: 2 });
    seedObjective(fake);
    seedCycle(fake);
    fake.table("plan_proposals").push({ id: "pp-1", tenant_id: TENANT, cycle_id: "cyc-1", decision: "REPLAN", created_at: "2026-02-01T00:00:00Z" });

    const result = await reviewCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.decision).toBe("WAIT");
    expect(fake.table("agent_events").find((r) => r.event_type === "supervisor.replan_requested")).toBeDefined();
  });

  it("uses the most recent plan_proposals row when more than one exists for the cycle", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    fake.table("plan_proposals").push({ id: "pp-1", tenant_id: TENANT, cycle_id: "cyc-1", decision: "REPLAN", created_at: "2026-02-01T00:00:00Z" });
    fake.table("plan_proposals").push({ id: "pp-2", tenant_id: TENANT, cycle_id: "cyc-1", decision: "NO_ACTION", created_at: "2026-02-01T01:00:00Z" });

    const result = await reviewCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.decision).toBe("COMPLETE");
  });
});
