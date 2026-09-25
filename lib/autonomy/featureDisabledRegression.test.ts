import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { AutonomyStoppedError } from "@/lib/autonomy/killSwitch";
import { observeObjective } from "@/lib/autonomy/observer";
import { planForCycle } from "@/lib/autonomy/planner";
import { createAndAuthorizeWork } from "@/lib/autonomy/authorityEngine";
import { executeWork } from "@/lib/autonomy/executionAdapter";
import { createObjective } from "@/lib/server/objectives";

/**
 * "Zero behavior change for pre-PHASE-1 tenants" regression (P1 task #89).
 * `tenant_autonomy_settings` is an additive table (migration
 * 20260925000000_ai_company_os_phase1_autonomy_core.sql) — no existing
 * tenant gets a row backfilled, and `feature_enabled` defaults to false for
 * any tenant that never opts in. This file proves that every Autonomy
 * Runtime entry point refuses to run for such a tenant *before* touching any
 * new table, so a pre-PHASE-1 tenant's data is never written to by code this
 * phase introduced — not just that the top-level call throws.
 */

const TENANT = "pre-phase1-tenant";

function newTablesTouchedCount(fake: FakeSupabase): number {
  const newTables = [
    "autonomy_cycles",
    "objective_observations",
    "plan_proposals",
    "works",
    "verifications",
    "impact_assessments",
    "cost_reservations",
    "execution_costs",
    "decision_logs",
    "cost_ledgers",
  ];
  return newTables.reduce((sum, name) => sum + fake.table(name).length, 0);
}

describe("feature_enabled=false / no settings row — zero side effects", () => {
  it("observeObjective throws before creating any autonomy_cycles or objective_observations row", async () => {
    const fake = new FakeSupabase();
    const objective = await createObjective(fake as unknown as never, TENANT, { title: "Existing tenant's objective" });

    await expect(observeObjective(fake as unknown as never, TENANT, objective.id)).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(newTablesTouchedCount(fake)).toBe(0);
  });

  it("planForCycle throws before creating any plan_proposals/decision_logs row", async () => {
    const fake = new FakeSupabase();
    await expect(
      planForCycle(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1" })
    ).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(newTablesTouchedCount(fake)).toBe(0);
  });

  it("createAndAuthorizeWork throws before creating any works/approval_requests row", async () => {
    const fake = new FakeSupabase();
    await expect(
      createAndAuthorizeWork(fake as unknown as never, TENANT, {
        cycleId: "cyc-1",
        objectiveId: "obj-1",
        planProposalId: "plan-1",
        observationId: null,
        proposedWork: { skillDefinitionId: "skill-1", title: "x", priority: "medium", estimatedCost: 0 },
      })
    ).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(newTablesTouchedCount(fake)).toBe(0);
    expect(fake.table("approval_requests")).toHaveLength(0);
  });

  it("executeWork throws before creating any execution_costs/agent_events row", async () => {
    const fake = new FakeSupabase();
    fake.table("works").push({ id: "work-1", tenant_id: TENANT, status: "APPROVED", skill_definition_id: "skill-1", cycle_id: "cyc-1", objective_id: "obj-1" });
    const baseline = newTablesTouchedCount(fake);

    await expect(executeWork(fake as unknown as never, TENANT, { workId: "work-1" })).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(newTablesTouchedCount(fake)).toBe(baseline);
    expect(fake.table("agent_events")).toHaveLength(0);
  });

  it("this tenant's own pre-existing tables (objectives, agent_events) are completely unaffected by the Autonomy Runtime existing at all", async () => {
    const fake = new FakeSupabase();
    const objective = await createObjective(fake as unknown as never, TENANT, { title: "Business as usual" });
    expect(fake.table("objectives")).toHaveLength(1);
    expect(objective.title).toBe("Business as usual");
    // createObjective itself never writes to any autonomy table — it is a
    // plain pre-existing-style CRUD function, unaffected by this phase.
    expect(newTablesTouchedCount(fake)).toBe(0);
  });
});
