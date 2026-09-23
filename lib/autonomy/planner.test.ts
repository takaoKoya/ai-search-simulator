import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { planForCycle } from "@/lib/autonomy/planner";
import { AutonomyStoppedError } from "@/lib/autonomy/killSwitch";
import { LLMProviderUnavailableError } from "@/lib/ai/llmProvider";

const TENANT = "t1";
const SKILL_ID = "11111111-1111-4111-8111-111111111111";

function seedTenant(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: TENANT,
    feature_enabled: true,
    autonomy_mode: "SHADOW",
    emergency_stop: false,
    max_works_per_cycle: 1,
    max_cycles_per_objective_per_day: 4,
    cooldown_after_execution_minutes: 30,
    ...overrides,
  });
}

function seedObjective(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("objectives").push({
    id: "obj-1",
    tenant_id: TENANT,
    title: "CVR改善",
    objective_type: "kpi_target",
    target_value: 0.05,
    current_value: 0.01,
    unit: "ratio",
    deadline: null,
    priority: "high",
    status: "AT_RISK",
    ...overrides,
  });
}

function seedCycle(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("autonomy_cycles").push({
    id: "cyc-1",
    tenant_id: TENANT,
    objective_id: "obj-1",
    cycle_number: 1,
    status: "RUNNING",
    started_at: new Date().toISOString(),
    ended_at: null,
    ...overrides,
  });
}

function seedObservation(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("objective_observations").push({
    id: "obs-1",
    tenant_id: TENANT,
    objective_id: "obj-1",
    cycle_id: "cyc-1",
    progress: 0.2,
    expected_progress: 0.5,
    gap: 0.04,
    risk_level: "HIGH",
    requires_planning: true,
    ...overrides,
  });
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
    ...overrides,
  });
}

describe("planForCycle", () => {
  it("throws AutonomyStoppedError when the kill switch is engaged, and writes no plan_proposals row", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { emergency_stop: true });
    seedObjective(fake);
    seedCycle(fake);
    seedObservation(fake);

    await expect(planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" })).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(fake.table("plan_proposals")).toHaveLength(0);
  });

  it("proposes NO_ACTION (via the deterministic Mock, in SHADOW mode) when the observation does not require planning", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    seedObservation(fake, { requires_planning: false, risk_level: "LOW" });

    const result = await planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.proposal.decision).toBe("NO_ACTION");
    expect(result.providerKind).toBe("MOCK");
    expect(fake.table("plan_proposals")).toHaveLength(1);
    expect(fake.table("plan_proposals")[0].decision).toBe("NO_ACTION");
  });

  it("proposes CREATE_WORK against a candidate skill when planning is required and no active work exists", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    seedObservation(fake);
    seedSkill(fake);

    const result = await planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.proposal.decision).toBe("CREATE_WORK");
    expect(result.proposal.proposedWorks).toHaveLength(1);
    expect(result.proposal.proposedWorks[0].skillDefinitionId).toBe(SKILL_ID);
    const logged = fake.table("decision_logs").find((row) => row.stage === "PLAN");
    expect(logged?.actor_type).toBe("AI");
    expect(logged?.action).toBe("CREATE_WORK");

    const event = fake.table("agent_events").find((row) => row.event_type === "plan.created");
    expect((event?.payload as { decision: string } | undefined)?.decision).toBe("CREATE_WORK");
  });

  it("proposes WAIT when an active work already exists for the objective, instead of duplicating it", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    seedObservation(fake);
    seedSkill(fake);
    fake.table("works").push({ id: "work-1", tenant_id: TENANT, objective_id: "obj-1", title: "Existing", status: "EXECUTING", skill_definition_id: SKILL_ID, created_at: new Date().toISOString() });

    const result = await planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.proposal.decision).toBe("WAIT");
    expect(result.proposal.proposedWorks).toHaveLength(0);
  });

  it("proposes ESCALATE when planning is required but no candidate skills are enabled", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
    seedCycle(fake);
    seedObservation(fake);

    const result = await planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" });

    expect(result.proposal.decision).toBe("ESCALATE");
  });

  it("Fail-Closed: throws LLMProviderUnavailableError in ASSISTED mode with no api key, never silently falling back to Mock, and transitions the cycle to FAILED", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { autonomy_mode: "ASSISTED" });
    seedObjective(fake);
    seedCycle(fake);
    seedObservation(fake);
    seedSkill(fake);

    await expect(planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" })).rejects.toBeInstanceOf(LLMProviderUnavailableError);

    expect(fake.table("autonomy_cycles")[0].status).toBe("FAILED");
    expect(fake.table("plan_proposals")).toHaveLength(0);
    const failureLog = fake.table("decision_logs").find((row) => row.action === "PLAN_FAILED");
    expect(failureLog?.actor_type).toBe("SYSTEM");
  });

  it("Fail-Closed: same in ACTIVE mode with no api key (Mock Prohibition)", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { autonomy_mode: "ACTIVE" });
    seedObjective(fake);
    seedCycle(fake);
    seedObservation(fake);
    seedSkill(fake);

    await expect(planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" })).rejects.toBeInstanceOf(LLMProviderUnavailableError);
    expect(fake.table("autonomy_cycles")[0].status).toBe("FAILED");
  });

  it("uses a real provider (an injected api key) in ASSISTED mode, never Mock, when one is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({ decision: "NO_ACTION", reasoningSummary: "Real provider says stand down.", confidence: 0.9, recommendedNextObservationAt: new Date().toISOString() }),
            },
          ],
        }),
      })
    );
    try {
      const fake = new FakeSupabase();
      seedTenant(fake, { autonomy_mode: "ASSISTED" });
      seedObjective(fake);
      seedCycle(fake);
      seedObservation(fake, { requires_planning: false });

      const result = await planForCycle(fake as unknown as never, TENANT, {
        cycleId: "cyc-1",
        objectiveId: "obj-1",
        llmOptions: { apiKeyOverride: "sk-test" },
      });

      expect(result.providerKind).toBe("REAL");
      expect(result.proposal.decision).toBe("NO_ACTION");
      expect(fake.table("plan_proposals")[0].provider_kind).toBe("REAL");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
