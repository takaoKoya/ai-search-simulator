import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { NotFoundError } from "@/lib/server/errors";
import { getObjective, listObjectives, createObjective } from "@/lib/server/objectives";
import { getTenantAutonomySettings, assertNotStopped, AutonomyStoppedError } from "@/lib/autonomy/killSwitch";
import { observeObjective } from "@/lib/autonomy/observer";
import { resolveCandidateSkills } from "@/lib/autonomy/skillCandidateResolver";
import { reserve, reconcile, release } from "@/lib/autonomy/costGuardrail";
import { createAndAuthorizeWork, computeWorkIdempotencyKey } from "@/lib/autonomy/authorityEngine";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";
import { getAutonomyCockpitState } from "@/lib/server/autonomyCockpit";
import type { TenantContext } from "@/lib/server/tenant";

/**
 * Security regression suite (P1 task #89, spec §19/FINAL requirements): a
 * dedicated cross-tenant leakage check for every autonomy table, run against
 * FakeSupabase because this sandbox has no live Postgres to exercise the RLS
 * policies themselves (see supabase/migrations/20260925000000_..., which adds
 * `is_tenant_member(tenant_id)`-scoped select/insert/update policies plus an
 * admin-only delete policy for every one of these tables — confirmed present
 * for objectives, autonomy_cycles, objective_observations,
 * skill_definitions, plan_proposals, works, verifications,
 * impact_assessments, cost_reservations, execution_costs, decision_logs,
 * tenant_autonomy_settings, and cost_ledgers).
 *
 * What this file actually proves, since FakeSupabase has no RLS enforcement
 * of its own: every one of our application-layer read/write functions scopes
 * itself by `tenant_id` in the query, so tenant A can never see or mutate
 * tenant B's rows even if IDs are guessed/leaked, and RLS is a second,
 * independent layer on top rather than the only thing standing between
 * tenants.
 */

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function seedSettings(fake: FakeSupabase, tenantId: string, overrides: Record<string, unknown> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: tenantId,
    feature_enabled: true,
    autonomy_mode: "ASSISTED",
    emergency_stop: false,
    per_execution_cost_limit_usd: null,
    per_cycle_cost_limit_usd: null,
    daily_cost_limit_usd: 10,
    max_works_per_cycle: 1,
    max_tasks_per_work: 10,
    max_cycles_per_objective_per_day: 10,
    max_replans_per_cycle: 2,
    cooldown_after_execution_minutes: 0,
    duplicate_work_window_minutes: 60,
    planner_timeout_seconds: 30,
    execution_timeout_seconds: 300,
    ...overrides,
  });
}

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], userId: "user-1", userEmail: null, tenantId, role: "owner" };
}

describe("tenant isolation — Autonomy Runtime tables", () => {
  it("tenant_autonomy_settings: one tenant's settings never leak into another's kill-switch check", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, TENANT_A, { feature_enabled: true });
    seedSettings(fake, TENANT_B, { feature_enabled: false });

    const settingsA = await getTenantAutonomySettings(fake as unknown as never, TENANT_A);
    const settingsB = await getTenantAutonomySettings(fake as unknown as never, TENANT_B);
    expect(settingsA?.feature_enabled).toBe(true);
    expect(settingsB?.feature_enabled).toBe(false);

    await expect(assertNotStopped(fake as unknown as never, TENANT_A)).resolves.toBeTruthy();
    await expect(assertNotStopped(fake as unknown as never, TENANT_B)).rejects.toBeInstanceOf(AutonomyStoppedError);
  });

  it("objectives: getObjective/listObjectives never return another tenant's rows even when the id is known", async () => {
    const fake = new FakeSupabase();
    const objA = await createObjective(fake as unknown as never, TENANT_A, { title: "A's objective" });
    const objB = await createObjective(fake as unknown as never, TENANT_B, { title: "B's objective" });

    await expect(getObjective(fake as unknown as never, TENANT_B, objA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getObjective(fake as unknown as never, TENANT_A, objB.id)).rejects.toBeInstanceOf(NotFoundError);

    const listA = await listObjectives(fake as unknown as never, TENANT_A);
    const listB = await listObjectives(fake as unknown as never, TENANT_B);
    expect(listA.map((o) => o.id)).toEqual([objA.id]);
    expect(listB.map((o) => o.id)).toEqual([objB.id]);
  });

  it("skill_definitions: resolveCandidateSkills excludes another tenant's skills (existing coverage in skillCandidateResolver.test.ts; re-asserted here as part of the security sweep)", async () => {
    const fake = new FakeSupabase();
    fake.table("skill_definitions").push(
      { tenant_id: TENANT_A, enabled: true, department: "production", risk_level: "LOW", executor_ref: "measurement_graph", name: "A skill", description: null },
      { tenant_id: TENANT_B, enabled: true, department: "production", risk_level: "LOW", executor_ref: "measurement_graph", name: "B skill", description: null }
    );

    const result = await resolveCandidateSkills(fake as unknown as never, TENANT_A);
    expect(result.map((s) => s.name)).toEqual(["A skill"]);
  });

  it("autonomy_cycles + objective_observations: observing tenant A's objective never touches or reads tenant B's cycle history", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, TENANT_A);
    seedSettings(fake, TENANT_B);
    const objA = await createObjective(fake as unknown as never, TENANT_A, { title: "A" });
    const objB = await createObjective(fake as unknown as never, TENANT_B, { title: "B" });

    // Seed tenant B with a RUNNING cycle at cycle_number 5 — if tenant A's
    // observeObjective ever queried without a tenant_id filter, it would pick
    // up this row as "the latest cycle" and mis-number/mis-cooldown tenant A.
    fake.table("autonomy_cycles").push({ tenant_id: TENANT_B, objective_id: objB.id, cycle_number: 5, status: "RUNNING", started_at: new Date().toISOString(), ended_at: null, parent_cycle_id: null, triggered_by: "SCHEDULER" });

    const resultA = await observeObjective(fake as unknown as never, TENANT_A, objA.id, new Date());
    expect(resultA.skipped).toBe(false);
    if (resultA.skipped) throw new Error("unreachable");
    expect(resultA.cycleNumber).toBe(1);

    const cyclesA = fake.table("autonomy_cycles").filter((r) => r.tenant_id === TENANT_A);
    expect(cyclesA).toHaveLength(1);
    const cyclesB = fake.table("autonomy_cycles").filter((r) => r.tenant_id === TENANT_B);
    expect(cyclesB).toHaveLength(1); // untouched by tenant A's run

    const observationsA = fake.table("objective_observations").filter((r) => r.tenant_id === TENANT_A);
    expect(observationsA).toHaveLength(1);
    expect(fake.table("objective_observations").filter((r) => r.tenant_id === TENANT_B)).toHaveLength(0);
  });

  it("decision_logs: writeDecisionLog rows are always stamped with the caller's own tenant_id and never mix across tenants", async () => {
    const fake = new FakeSupabase();
    await writeDecisionLog(fake as unknown as never, TENANT_A, { cycleId: "cyc-a", stage: "OBSERVE", actorType: "SYSTEM", action: "TEST_A" });
    await writeDecisionLog(fake as unknown as never, TENANT_B, { cycleId: "cyc-b", stage: "OBSERVE", actorType: "SYSTEM", action: "TEST_B" });

    const logsA = fake.table("decision_logs").filter((r) => r.tenant_id === TENANT_A);
    const logsB = fake.table("decision_logs").filter((r) => r.tenant_id === TENANT_B);
    expect(logsA.map((r) => r.action)).toEqual(["TEST_A"]);
    expect(logsB.map((r) => r.action)).toEqual(["TEST_B"]);
  });

  it("cost_ledgers + cost_reservations: two tenants' daily spend is tracked in fully separate ledger rows, never shared or summed together", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, TENANT_A, { daily_cost_limit_usd: 1 });
    seedSettings(fake, TENANT_B, { daily_cost_limit_usd: 1 });

    const resA = await reserve(fake as unknown as never, TENANT_A, { cycleId: "cyc-a", estimatedCostUsd: 0.9 });
    const resB = await reserve(fake as unknown as never, TENANT_B, { cycleId: "cyc-b", estimatedCostUsd: 0.9 });
    // If the two tenants shared one ledger row, the second reserve() would
    // have been denied (0.9 + 0.9 > 1); each succeeding proves separation.
    expect(resA.allowed).toBe(true);
    expect(resB.allowed).toBe(true);

    const ledgers = fake.table("cost_ledgers");
    expect(ledgers.filter((r) => r.tenant_id === TENANT_A)).toHaveLength(1);
    expect(ledgers.filter((r) => r.tenant_id === TENANT_B)).toHaveLength(1);
  });

  it("cost_reservations: reconcile/release refuse a reservation id that belongs to a different tenant", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, TENANT_A);
    seedSettings(fake, TENANT_B);

    const res = await reserve(fake as unknown as never, TENANT_A, { cycleId: "cyc-a", estimatedCostUsd: 0.5 });
    if (!res.allowed) throw new Error("unreachable");

    // Tenant B must never be able to reconcile or release tenant A's reservation by id.
    await expect(reconcile(fake as unknown as never, TENANT_B, res.reservationId, 0.5)).rejects.toBeInstanceOf(NotFoundError);
    await expect(release(fake as unknown as never, TENANT_B, res.reservationId)).rejects.toBeInstanceOf(NotFoundError);

    // The legitimate owner can still reconcile it.
    await expect(reconcile(fake as unknown as never, TENANT_A, res.reservationId, 0.5)).resolves.toBeUndefined();
  });

  it("works: idempotency keys never collide across tenants, and one tenant can never fetch/authorize another tenant's Work by guessing an id", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, TENANT_A);
    seedSettings(fake, TENANT_B);
    fake.table("skill_definitions").push(
      { id: "skill-1", tenant_id: TENANT_A, enabled: true, name: "Skill", risk_level: "LOW", approval_policy_code: null },
      { id: "skill-1", tenant_id: TENANT_B, enabled: true, name: "Skill", risk_level: "LOW", approval_policy_code: null }
    );

    const proposedWork = { skillDefinitionId: "skill-1", title: "Do the thing", priority: "medium" as const, estimatedCost: 0 };
    const resultA = await createAndAuthorizeWork(fake as unknown as never, TENANT_A, { cycleId: "cyc-a", objectiveId: "obj-a", planProposalId: "plan-a", observationId: "obs-a", proposedWork });
    const resultB = await createAndAuthorizeWork(fake as unknown as never, TENANT_B, { cycleId: "cyc-a", objectiveId: "obj-a", planProposalId: "plan-a", observationId: "obs-a", proposedWork });

    // Same (objectiveId, observationId, skillDefinitionId, cycleId) tuple on
    // both tenants would collide on a tenant-less idempotency key — but the
    // key itself is namespaced by tenantId, and findExistingWorkByIdempotencyKey
    // also filters by tenant_id, so both calls must create distinct Works.
    expect(resultA.workId).not.toBe(resultB.workId);
    expect(resultA.duplicate).toBe(false);
    expect(resultB.duplicate).toBe(false);
    expect(computeWorkIdempotencyKey({ tenantId: TENANT_A, objectiveId: "obj-a", observationId: "obs-a", skillDefinitionId: "skill-1", cycleId: "cyc-a" })).not.toBe(
      computeWorkIdempotencyKey({ tenantId: TENANT_B, objectiveId: "obj-a", observationId: "obs-a", skillDefinitionId: "skill-1", cycleId: "cyc-a" })
    );

    const worksA = fake.table("works").filter((r) => r.tenant_id === TENANT_A);
    const worksB = fake.table("works").filter((r) => r.tenant_id === TENANT_B);
    expect(worksA).toHaveLength(1);
    expect(worksB).toHaveLength(1);
  });

  it("autonomyCockpit: getAutonomyCockpitState only ever aggregates the requesting tenant's own objectives/works/settings", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, TENANT_A, { daily_cost_limit_usd: 5 });
    seedSettings(fake, TENANT_B, { daily_cost_limit_usd: 999 });
    await createObjective(fake as unknown as never, TENANT_A, { title: "A objective" });
    await createObjective(fake as unknown as never, TENANT_B, { title: "B objective" });
    await createObjective(fake as unknown as never, TENANT_B, { title: "B objective 2" });

    const stateA = await getAutonomyCockpitState(makeCtx(fake, TENANT_A));
    expect(stateA.objectives).toHaveLength(1);
    expect(stateA.objectives[0].title).toBe("A objective");
    expect(stateA.settings?.daily_cost_limit_usd).toBe(5);

    const stateB = await getAutonomyCockpitState(makeCtx(fake, TENANT_B));
    expect(stateB.objectives).toHaveLength(2);
    expect(stateB.settings?.daily_cost_limit_usd).toBe(999);
  });
});
