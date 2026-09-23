import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { AutonomyStoppedError } from "@/lib/autonomy/killSwitch";
import { ValidationError } from "@/lib/server/errors";

vi.mock("@/lib/langgraph/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/langgraph/orchestrator")>();
  return { ...actual, runBusinessGraph: vi.fn() };
});

import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { executeWork } from "@/lib/autonomy/executionAdapter";

const TENANT = "t1";
const SKILL_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function seedTenant(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: TENANT,
    feature_enabled: true,
    autonomy_mode: "ACTIVE",
    emergency_stop: false,
    execution_timeout_seconds: 300,
    ...overrides,
  });
}

function seedSkill(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("skill_definitions").push({ id: SKILL_ID, tenant_id: TENANT, executor_ref: "measurement_graph", ...overrides });
}

function seedObjective(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("objectives").push({ id: "obj-1", tenant_id: TENANT, title: "CVR改善", status: "AT_RISK", project_id: PROJECT_ID, ...overrides });
}

function seedWork(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("works").push({ id: "work-1", tenant_id: TENANT, objective_id: "obj-1", cycle_id: "cyc-1", skill_definition_id: SKILL_ID, status: "APPROVED", ...overrides });
}

describe("executeWork", () => {
  it("throws AutonomyStoppedError when the kill switch is engaged, and never calls runBusinessGraph", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { emergency_stop: true });
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake);

    await expect(executeWork(fake as unknown as never, TENANT, { workId: "work-1" })).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(runBusinessGraph).not.toHaveBeenCalled();
  });

  it("throws ValidationError when the Work is not APPROVED", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake, { status: "PROPOSED" });

    await expect(executeWork(fake as unknown as never, TENANT, { workId: "work-1" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("Shadow Mode: skips execution entirely, moves the Work to CANCELLED, and never calls runBusinessGraph", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { autonomy_mode: "SHADOW" });
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake);

    const result = await executeWork(fake as unknown as never, TENANT, { workId: "work-1" });

    expect(result.outcome).toBe("SHADOW_SKIPPED");
    expect(fake.table("works")[0].status).toBe("CANCELLED");
    expect(runBusinessGraph).not.toHaveBeenCalled();
    const log = fake.table("decision_logs").find((r) => r.stage === "EXECUTE");
    expect(log?.action).toBe("SHADOW_MODE_SKIPPED");
  });

  it("throws ValidationError (and marks the Work FAILED) when the objective has no linked project", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedObjective(fake, { project_id: null });
    seedWork(fake);

    await expect(executeWork(fake as unknown as never, TENANT, { workId: "work-1" })).rejects.toBeInstanceOf(ValidationError);
    expect(fake.table("works")[0].status).toBe("FAILED");
  });

  it("throws ValidationError (and marks the Work FAILED) for an executor_ref the PHASE 1 adapter does not yet support", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake, { executor_ref: "sales_graph" });
    seedObjective(fake);
    seedWork(fake);

    await expect(executeWork(fake as unknown as never, TENANT, { workId: "work-1" })).rejects.toBeInstanceOf(ValidationError);
    expect(fake.table("works")[0].status).toBe("FAILED");
  });

  it("on a completed graph run, moves the Work to COMPLETED and passes projectId/cycleId through to runBusinessGraph", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake);
    vi.mocked(runBusinessGraph).mockResolvedValueOnce({ status: "completed" });

    const result = await executeWork(fake as unknown as never, TENANT, { workId: "work-1" });

    expect(result.outcome).toBe("COMPLETED");
    expect(fake.table("works")[0].status).toBe("COMPLETED");
    expect(runBusinessGraph).toHaveBeenCalledWith(
      expect.objectContaining({ graphName: "measurement_graph", cycleId: "cyc-1", input: expect.objectContaining({ projectId: PROJECT_ID }) })
    );
    const log = fake.table("decision_logs").find((r) => r.stage === "EXECUTE");
    expect(log?.action).toBe("COMPLETED");
    expect(fake.table("agent_events").find((r) => r.event_type === "execution.started")).toBeDefined();
    expect(fake.table("agent_events").find((r) => r.event_type === "execution.completed")).toBeDefined();
    expect(fake.table("agent_events").find((r) => r.event_type === "work.completed")).toBeDefined();
  });

  it("resolves the company name from projects.clients for renewal_graph", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake, { executor_ref: "renewal_graph" });
    seedObjective(fake);
    seedWork(fake);
    fake.table("projects").push({ id: PROJECT_ID, tenant_id: TENANT, client_id: "client-1", clients: { name: "テスト株式会社" } });
    vi.mocked(runBusinessGraph).mockResolvedValueOnce({ status: "completed" });

    await executeWork(fake as unknown as never, TENANT, { workId: "work-1" });

    expect(runBusinessGraph).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ projectId: PROJECT_ID, companyName: "テスト株式会社" }) }));
  });

  it("on a waiting_human graph result, moves the Work to BLOCKED", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake);
    vi.mocked(runBusinessGraph).mockResolvedValueOnce({ status: "waiting_human" });

    const result = await executeWork(fake as unknown as never, TENANT, { workId: "work-1" });

    expect(result.outcome).toBe("BLOCKED");
    expect(fake.table("works")[0].status).toBe("BLOCKED");
  });

  it("on a failed graph result, moves the Work to FAILED", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake);
    vi.mocked(runBusinessGraph).mockResolvedValueOnce({ status: "failed" });

    const result = await executeWork(fake as unknown as never, TENANT, { workId: "work-1" });

    expect(result.outcome).toBe("FAILED");
    expect(fake.table("works")[0].status).toBe("FAILED");
  });

  it("when runBusinessGraph itself throws, marks the Work FAILED and rethrows", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake);
    vi.mocked(runBusinessGraph).mockRejectedValueOnce(new Error("graph blew up"));

    await expect(executeWork(fake as unknown as never, TENANT, { workId: "work-1" })).rejects.toThrow("graph blew up");
    expect(fake.table("works")[0].status).toBe("FAILED");
  });

  it("marks the Work FAILED when execution exceeds execution_timeout_seconds, without waiting for the graph to ever resolve", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { execution_timeout_seconds: 0.01 });
    seedSkill(fake);
    seedObjective(fake);
    seedWork(fake);
    vi.mocked(runBusinessGraph).mockImplementationOnce(() => new Promise(() => {}));

    await expect(executeWork(fake as unknown as never, TENANT, { workId: "work-1" })).rejects.toThrow(/timed out/);
    expect(fake.table("works")[0].status).toBe("FAILED");
  });
});
