import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";

const TENANT = "t1";

describe("writeDecisionLog", () => {
  it("writes a decision_logs row with all fields, defaulting optional ones", async () => {
    const fake = new FakeSupabase();

    await writeDecisionLog(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      workId: "work-1",
      stage: "AUTHORIZE",
      actorType: "SYSTEM",
      action: "AUTO",
      reasoningSummary: "no policy gates this skill",
      reasonCodes: ["AUTHORITY_AUTO"],
    });

    expect(fake.table("decision_logs")).toHaveLength(1);
    const row = fake.table("decision_logs")[0];
    expect(row).toMatchObject({
      tenant_id: TENANT,
      cycle_id: "cyc-1",
      objective_id: "obj-1",
      work_id: "work-1",
      stage: "AUTHORIZE",
      actor_type: "SYSTEM",
      actor_id: null,
      action: "AUTO",
      reasoning_summary: "no policy gates this skill",
      reason_codes: ["AUTHORITY_AUTO"],
    });
  });

  it("defaults objectiveId/workId/actorId to null and reasonCodes to an empty array when omitted", async () => {
    const fake = new FakeSupabase();

    await writeDecisionLog(fake as unknown as never, TENANT, { cycleId: "cyc-1", stage: "OBSERVE", actorType: "SYSTEM", action: "OBSERVATION_RECORDED" });

    const row = fake.table("decision_logs")[0];
    expect(row.objective_id).toBeNull();
    expect(row.work_id).toBeNull();
    expect(row.actor_id).toBeNull();
    expect(row.reasoning_summary).toBeNull();
    expect(row.reason_codes).toEqual([]);
  });

  it("records a HUMAN actor with an actorId, distinguishable from a SYSTEM/AI decision on the same cycle", async () => {
    const fake = new FakeSupabase();

    await writeDecisionLog(fake as unknown as never, TENANT, { cycleId: "cyc-1", workId: "work-1", stage: "HUMAN_INTERVENTION", actorType: "HUMAN", actorId: "user-1", action: "APPROVE" });

    const row = fake.table("decision_logs")[0];
    expect(row.actor_type).toBe("HUMAN");
    expect(row.actor_id).toBe("user-1");
  });
});
