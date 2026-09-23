import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { createObjective, listObjectives, getObjective, updateObjectiveStatus } from "@/lib/server/objectives";
import { NotFoundError } from "@/lib/server/errors";

const TENANT = "t1";

describe("objectives service", () => {
  it("creates an objective in DRAFT status", async () => {
    const fake = new FakeSupabase();
    const obj = await createObjective(fake as unknown as never, TENANT, { title: "CVR改善", targetValue: 0.05, unit: "ratio" });
    expect(obj.status).toBe("DRAFT");
    expect(obj.title).toBe("CVR改善");
    expect(obj.tenant_id).toBe(TENANT);
  });

  it("emits an objective.created agent_events row", async () => {
    const fake = new FakeSupabase();
    const obj = await createObjective(fake as unknown as never, TENANT, { title: "CVR改善" });

    const event = fake.table("agent_events").find((e) => e.event_type === "objective.created");
    expect(event?.tenant_id).toBe(TENANT);
    expect((event?.payload as { objectiveId: string }).objectiveId).toBe(obj.id);
  });

  it("lists only the acting tenant's objectives, optionally filtered by status", async () => {
    const fake = new FakeSupabase();
    fake.table("objectives").push({ id: "o1", tenant_id: TENANT, title: "A", status: "ACTIVE", created_at: "2026-01-01" });
    fake.table("objectives").push({ id: "o2", tenant_id: TENANT, title: "B", status: "DRAFT", created_at: "2026-01-02" });
    fake.table("objectives").push({ id: "o3", tenant_id: "other-tenant", title: "C", status: "ACTIVE", created_at: "2026-01-03" });

    const all = await listObjectives(fake as unknown as never, TENANT);
    expect(all.map((o) => o.id).sort()).toEqual(["o1", "o2"]);

    const activeOnly = await listObjectives(fake as unknown as never, TENANT, { status: "ACTIVE" });
    expect(activeOnly.map((o) => o.id)).toEqual(["o1"]);
  });

  it("getObjective throws NotFoundError for a missing or cross-tenant id", async () => {
    const fake = new FakeSupabase();
    fake.table("objectives").push({ id: "o1", tenant_id: "other-tenant", title: "A", status: "ACTIVE" });
    await expect(getObjective(fake as unknown as never, TENANT, "o1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getObjective(fake as unknown as never, TENANT, "missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateObjectiveStatus updates status and optionally current_value, scoped to tenant", async () => {
    const fake = new FakeSupabase();
    fake.table("objectives").push({ id: "o1", tenant_id: TENANT, status: "ACTIVE", current_value: 0.02 });

    await updateObjectiveStatus(fake as unknown as never, TENANT, "o1", "AT_RISK", 0.021);

    const row = fake.table("objectives")[0];
    expect(row.status).toBe("AT_RISK");
    expect(row.current_value).toBe(0.021);
  });
});
