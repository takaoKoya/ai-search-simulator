import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { assessImpact, classifyImpact } from "@/lib/autonomy/impactAssessor";

const TENANT = "t1";

describe("classifyImpact (pure)", () => {
  it("is UNKNOWN when the verdict is not PASS, regardless of skill", () => {
    expect(classifyImpact({ verdict: "FAIL", skillExecutorRef: "measurement_graph", recentKpiSnapshots: [] }).classification).toBe("UNKNOWN");
    expect(classifyImpact({ verdict: "ESCALATE", skillExecutorRef: "measurement_graph", recentKpiSnapshots: [] }).classification).toBe("UNKNOWN");
  });

  it("is DIRECT_KPI_CHANGE for measurement_graph's first-ever recorded value", () => {
    const result = classifyImpact({ verdict: "PASS", skillExecutorRef: "measurement_graph", recentKpiSnapshots: [{ value: 0.05 }] });
    expect(result.classification).toBe("DIRECT_KPI_CHANGE");
  });

  it("is DIRECT_KPI_CHANGE for measurement_graph when the value changed from the previous snapshot", () => {
    const result = classifyImpact({ verdict: "PASS", skillExecutorRef: "measurement_graph", recentKpiSnapshots: [{ value: 0.06 }, { value: 0.05 }] });
    expect(result.classification).toBe("DIRECT_KPI_CHANGE");
  });

  it("is NO_MEASURABLE_CHANGE for measurement_graph when the value is unchanged", () => {
    const result = classifyImpact({ verdict: "PASS", skillExecutorRef: "measurement_graph", recentKpiSnapshots: [{ value: 0.05 }, { value: 0.05 }] });
    expect(result.classification).toBe("NO_MEASURABLE_CHANGE");
  });

  it("is NO_MEASURABLE_CHANGE for measurement_graph when no snapshot value was recorded at all", () => {
    const result = classifyImpact({ verdict: "PASS", skillExecutorRef: "measurement_graph", recentKpiSnapshots: [] });
    expect(result.classification).toBe("NO_MEASURABLE_CHANGE");
  });

  it("is INDIRECT_CONTRIBUTION for renewal_graph, which never writes a KPI value", () => {
    const result = classifyImpact({ verdict: "PASS", skillExecutorRef: "renewal_graph", recentKpiSnapshots: [] });
    expect(result.classification).toBe("INDIRECT_CONTRIBUTION");
  });

  it("is UNKNOWN for a skill with no defined classification rule", () => {
    const result = classifyImpact({ verdict: "PASS", skillExecutorRef: "sales_graph", recentKpiSnapshots: [] });
    expect(result.classification).toBe("UNKNOWN");
  });
});

describe("assessImpact", () => {
  it("records DIRECT_KPI_CHANGE and never itself writes kpis.current_value (the verified skill already did)", async () => {
    const fake = new FakeSupabase();
    fake.table("kpis").push({ id: "kpi-1", tenant_id: TENANT, objective_id: "obj-1", current_value: 0.06, created_at: "2026-01-01T00:00:00Z" });
    fake.table("kpi_snapshots").push({ id: "snap-1", tenant_id: TENANT, kpi_id: "kpi-1", snapshot_type: "CURRENT", value: 0.05, created_at: "2026-01-15T00:00:00Z" });
    fake.table("kpi_snapshots").push({ id: "snap-2", tenant_id: TENANT, kpi_id: "kpi-1", snapshot_type: "CURRENT", value: 0.06, created_at: "2026-02-01T00:00:00Z" });

    const result = await assessImpact(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      verificationId: "ver-1",
      skillExecutorRef: "measurement_graph",
      verdict: "PASS",
    });

    expect(result.classification).toBe("DIRECT_KPI_CHANGE");
    expect(fake.table("impact_assessments")).toHaveLength(1);
    expect(fake.table("impact_assessments")[0].kpi_id).toBe("kpi-1");
    // The kpis row is untouched by this module — measurement_graph is the only writer of current_value.
    expect(fake.table("kpis")[0].current_value).toBe(0.06);
    const updateKpiLog = fake.table("decision_logs").find((r) => r.stage === "UPDATE_KPI");
    expect(updateKpiLog?.action).toBe("KPI_ALREADY_UPDATED_BY_VERIFIED_SKILL");
    expect(fake.table("agent_events").find((r) => r.event_type === "kpi.autonomy_updated")).toBeDefined();
  });

  it("records INDIRECT_CONTRIBUTION for a PASSed renewal_graph, with no kpi_id", async () => {
    const fake = new FakeSupabase();

    const result = await assessImpact(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      verificationId: "ver-1",
      skillExecutorRef: "renewal_graph",
      verdict: "PASS",
    });

    expect(result.classification).toBe("INDIRECT_CONTRIBUTION");
    expect(fake.table("impact_assessments")[0].kpi_id).toBeNull();
  });

  it("records UNKNOWN, with no ASSESS_IMPACT->UPDATE_KPI log, when the verdict is not PASS", async () => {
    const fake = new FakeSupabase();

    const result = await assessImpact(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      verificationId: "ver-1",
      skillExecutorRef: "measurement_graph",
      verdict: "FAIL",
    });

    expect(result.classification).toBe("UNKNOWN");
    expect(fake.table("decision_logs").filter((r) => r.stage === "UPDATE_KPI")).toHaveLength(0);
  });
});
