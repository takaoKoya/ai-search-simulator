import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { observeObjective } from "@/lib/autonomy/observer";
import { AutonomyStoppedError } from "@/lib/autonomy/killSwitch";

const TENANT = "t1";
const NOW = new Date("2026-02-01T00:00:00Z");

function seedTenant(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: TENANT,
    feature_enabled: true,
    autonomy_mode: "ASSISTED",
    emergency_stop: false,
    max_cycles_per_objective_per_day: 4,
    cooldown_after_execution_minutes: 30,
    ...overrides,
  });
}

function seedObjective(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("objectives").push({ id: "obj-1", tenant_id: TENANT, title: "CVR改善", status: "ACTIVE", start_date: null, deadline: null, ...overrides });
}

describe("observeObjective", () => {
  it("throws AutonomyStoppedError when the kill switch is engaged", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { emergency_stop: true });
    seedObjective(fake);
    await expect(observeObjective(fake as unknown as never, TENANT, "obj-1", NOW)).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(fake.table("autonomy_cycles")).toHaveLength(0);
  });

  it("records NO_KPI_LINKED and does not require planning when the objective has no KPI", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);

    const result = await observeObjective(fake as unknown as never, TENANT, "obj-1", NOW);

    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("unreachable");
    expect(result.observation.reason_codes).toContain("NO_KPI_LINKED");
    expect(result.observation.requires_planning).toBe(false);
    expect(result.cycleNumber).toBe(1);
    expect(fake.table("autonomy_cycles")[0].status).toBe("RUNNING");
  });

  it("classifies an off-target KPI as HIGH risk, requires planning, and moves the objective to AT_RISK", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedObjective(fake);
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

    const result = await observeObjective(fake as unknown as never, TENANT, "obj-1", NOW);

    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("unreachable");
    expect(result.observation.risk_level).toBe("HIGH");
    expect(result.observation.requires_planning).toBe(true);
    expect(fake.table("objectives")[0].status).toBe("AT_RISK");
  });

  it("skips (no new cycle) inside the cooldown window after a just-ended cycle", async () => {
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

    const result = await observeObjective(fake as unknown as never, TENANT, "obj-1", NOW);

    expect(result).toEqual({ skipped: true, reason: "COOLDOWN" });
    expect(fake.table("autonomy_cycles")).toHaveLength(1);
  });

  it("skips once max_cycles_per_objective_per_day is reached today", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { max_cycles_per_objective_per_day: 2, cooldown_after_execution_minutes: 0 });
    seedObjective(fake);
    for (let i = 1; i <= 2; i += 1) {
      fake.table("autonomy_cycles").push({
        id: `cyc-${i}`,
        tenant_id: TENANT,
        objective_id: "obj-1",
        cycle_number: i,
        status: "COMPLETED",
        started_at: NOW.toISOString(),
        ended_at: NOW.toISOString(),
      });
    }

    const result = await observeObjective(fake as unknown as never, TENANT, "obj-1", NOW);

    expect(result).toEqual({ skipped: true, reason: "MAX_CYCLES_REACHED" });
  });

  it("chains parent_cycle_id to the previous cycle and increments cycle_number", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { cooldown_after_execution_minutes: 0 });
    seedObjective(fake);
    fake.table("autonomy_cycles").push({
      id: "cyc-prev",
      tenant_id: TENANT,
      objective_id: "obj-1",
      cycle_number: 1,
      status: "COMPLETED",
      started_at: new Date(NOW.getTime() - 3600_000).toISOString(),
      ended_at: new Date(NOW.getTime() - 3600_000).toISOString(),
    });

    const result = await observeObjective(fake as unknown as never, TENANT, "obj-1", NOW);

    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("unreachable");
    expect(result.cycleNumber).toBe(2);
    const newCycle = fake.table("autonomy_cycles").find((c) => c.id === result.cycleId);
    expect(newCycle?.parent_cycle_id).toBe("cyc-prev");
  });
});
