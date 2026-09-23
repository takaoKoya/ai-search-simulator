import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { transitionCycle, transitionWork, IllegalStateTransitionError } from "@/lib/autonomy/stateTransition";
import { NotFoundError } from "@/lib/server/errors";

const TENANT = "t1";

describe("transitionCycle", () => {
  it("allows a legal transition and sets ended_at", async () => {
    const fake = new FakeSupabase();
    fake.table("autonomy_cycles").push({ id: "cyc-1", tenant_id: TENANT, status: "RUNNING" });

    await transitionCycle(fake as unknown as never, TENANT, "cyc-1", "COMPLETED", { outcome: "NO_ACTION" });

    const row = fake.table("autonomy_cycles")[0];
    expect(row.status).toBe("COMPLETED");
    expect(row.outcome).toBe("NO_ACTION");
    expect(row.ended_at).toBeTruthy();
  });

  it("rejects ESCALATED -> RUNNING (terminal state has no outgoing transition)", async () => {
    const fake = new FakeSupabase();
    fake.table("autonomy_cycles").push({ id: "cyc-2", tenant_id: TENANT, status: "ESCALATED" });

    await expect(transitionCycle(fake as unknown as never, TENANT, "cyc-2", "RUNNING")).rejects.toBeInstanceOf(IllegalStateTransitionError);
    expect(fake.table("autonomy_cycles")[0].status).toBe("ESCALATED");
  });

  it("throws NotFoundError for an unknown cycle id", async () => {
    const fake = new FakeSupabase();
    await expect(transitionCycle(fake as unknown as never, TENANT, "missing", "COMPLETED")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never lets one tenant transition another tenant's cycle", async () => {
    const fake = new FakeSupabase();
    fake.table("autonomy_cycles").push({ id: "cyc-3", tenant_id: "other-tenant", status: "RUNNING" });

    await expect(transitionCycle(fake as unknown as never, TENANT, "cyc-3", "COMPLETED")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("transitionWork", () => {
  it("rejects COMPLETED -> EXECUTING", async () => {
    const fake = new FakeSupabase();
    fake.table("works").push({ id: "w-1", tenant_id: TENANT, status: "COMPLETED" });

    await expect(transitionWork(fake as unknown as never, TENANT, "w-1", "EXECUTING")).rejects.toBeInstanceOf(IllegalStateTransitionError);
  });

  it("rejects DENIED -> EXECUTING (Hard DENY is a terminal state with no escape)", async () => {
    const fake = new FakeSupabase();
    fake.table("works").push({ id: "w-2", tenant_id: TENANT, status: "DENIED" });

    await expect(transitionWork(fake as unknown as never, TENANT, "w-2", "EXECUTING")).rejects.toBeInstanceOf(IllegalStateTransitionError);
  });

  it("allows the full happy-path chain PROPOSED -> APPROVED -> EXECUTING -> COMPLETED", async () => {
    const fake = new FakeSupabase();
    fake.table("works").push({ id: "w-3", tenant_id: TENANT, status: "PROPOSED" });

    await transitionWork(fake as unknown as never, TENANT, "w-3", "APPROVED");
    await transitionWork(fake as unknown as never, TENANT, "w-3", "EXECUTING");
    await transitionWork(fake as unknown as never, TENANT, "w-3", "COMPLETED");

    expect(fake.table("works")[0].status).toBe("COMPLETED");
  });
});
