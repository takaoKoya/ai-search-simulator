import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { deriveVerdict, verifyExecution } from "@/lib/autonomy/verifier";

const TENANT = "t1";
const PROJECT_ID = "proj-1";

describe("deriveVerdict (pure)", () => {
  it("is ESCALATE when there are no checks at all", () => {
    expect(deriveVerdict([])).toBe("ESCALATE");
  });

  it("is PASS only when every check passed", () => {
    expect(deriveVerdict([{ name: "a", passed: true }, { name: "b", passed: true }])).toBe("PASS");
  });

  it("is FAIL when any check failed", () => {
    expect(deriveVerdict([{ name: "a", passed: true }, { name: "b", passed: false }])).toBe("FAIL");
  });
});

describe("verifyExecution", () => {
  it("PASS: measurement_graph with a fresh CURRENT kpi_snapshot present", async () => {
    const fake = new FakeSupabase();
    fake.table("kpi_snapshots").push({ id: "snap-1", tenant_id: TENANT, project_id: PROJECT_ID, snapshot_type: "CURRENT", value: 0.05, created_at: "2026-02-01T00:00:00Z" });

    const result = await verifyExecution(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      skillExecutorRef: "measurement_graph",
      projectId: PROJECT_ID,
    });

    expect(result.verdict).toBe("PASS");
    expect(fake.table("verifications")).toHaveLength(1);
    expect(fake.table("verifications")[0].verdict).toBe("PASS");
    const log = fake.table("decision_logs").find((r) => r.stage === "VERIFY");
    expect(log?.action).toBe("PASS");
  });

  it("FAIL: measurement_graph with no CURRENT kpi_snapshot recorded at all — never trusts the graph's own self-report", async () => {
    const fake = new FakeSupabase();

    const result = await verifyExecution(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      skillExecutorRef: "measurement_graph",
      projectId: PROJECT_ID,
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.checks.find((c) => c.name === "CURRENT_KPI_SNAPSHOT_EXISTS")?.passed).toBe(false);
  });

  it("FAIL: measurement_graph with a snapshot row but a null value", async () => {
    const fake = new FakeSupabase();
    fake.table("kpi_snapshots").push({ id: "snap-1", tenant_id: TENANT, project_id: PROJECT_ID, snapshot_type: "CURRENT", value: null, created_at: "2026-02-01T00:00:00Z" });

    const result = await verifyExecution(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      skillExecutorRef: "measurement_graph",
      projectId: PROJECT_ID,
    });

    expect(result.verdict).toBe("FAIL");
  });

  it("PASS: renewal_graph with a contract_renewals row carrying a risk_level", async () => {
    const fake = new FakeSupabase();
    fake.table("contract_renewals").push({ id: "ren-1", tenant_id: TENANT, project_id: PROJECT_ID, risk_level: "YELLOW", created_at: "2026-02-01T00:00:00Z" });

    const result = await verifyExecution(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      skillExecutorRef: "renewal_graph",
      projectId: PROJECT_ID,
    });

    expect(result.verdict).toBe("PASS");
  });

  it("ESCALATE: no deterministic check is defined for an unsupported executor_ref — never silently passes", async () => {
    const fake = new FakeSupabase();

    const result = await verifyExecution(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      skillExecutorRef: "sales_graph",
      projectId: PROJECT_ID,
    });

    expect(result.verdict).toBe("ESCALATE");
  });

  it("ESCALATE: no project linked at all — a scope gap, not a checked-and-failed result", async () => {
    const fake = new FakeSupabase();

    const result = await verifyExecution(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      skillExecutorRef: "measurement_graph",
      projectId: null,
    });

    expect(result.verdict).toBe("ESCALATE");
  });
});
