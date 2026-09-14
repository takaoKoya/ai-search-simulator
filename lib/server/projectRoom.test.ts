import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { getProjectRoomState } from "@/lib/server/projectRoom";
import type { TenantContext } from "@/lib/server/tenant";

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "u1", userEmail: null, role: "owner" };
}

describe("getProjectRoomState", () => {
  it("computes the Delivery Gate from real task/deliverable/approval rows", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("clients").push({ id: "client-1", tenant_id: tenantId, name: "サンプル商事株式会社" });
    fake.table("projects").push({ id: "proj-1", tenant_id: tenantId, name: "サンプルSEOプロジェクト", project_type: "seo_geo", status: "active", client_id: "client-1", contract_id: null });
    fake.table("agents").push({ id: "agent-taku", tenant_id: tenantId, code: "taku", name: "タク", role: "director", status: "idle" });
    fake.table("project_team_members").push({ id: "ptm-1", tenant_id: tenantId, project_id: "proj-1", agent_id: "agent-taku", role_in_project: "taku" });
    fake.table("tasks").push(
      { id: "task-1", tenant_id: tenantId, project_id: "proj-1", title: "現状分析", status: "done", assigned_agent_id: "agent-taku", sequence: 1 },
      { id: "task-2", tenant_id: tenantId, project_id: "proj-1", title: "改善提案", status: "done", assigned_agent_id: "agent-taku", sequence: 2 }
    );
    fake.table("deliverables").push({ id: "del-1", tenant_id: tenantId, project_id: "proj-1", task_id: "task-1", title: "現状分析 成果物", status: "approved" });

    const ctx = makeCtx(fake, tenantId);
    const state = await getProjectRoomState(ctx, "proj-1");

    expect(state.project.name).toBe("サンプルSEOプロジェクト");
    expect(state.project.client?.name).toBe("サンプル商事株式会社");
    expect(state.progress).toEqual({ doneTasks: 2, totalTasks: 2, blockedTasks: 0 });
    expect(state.deliveryGate.executionComplete).toBe(true);
    expect(state.deliveryGate.criticPassed).toBe(true);
    // Only 1 of 2 tasks has an approved deliverable -> QA gate not fully passed.
    expect(state.deliveryGate.qaPassed).toBe(false);
    expect(state.deliveryGate.ceoApproved).toBe(false);
    expect(state.team).toHaveLength(1);
  });

  it("marks the Delivery Gate blocked when a task is blocked", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("projects").push({ id: "proj-1", tenant_id: tenantId, name: "プロジェクト", project_type: "seo_geo", status: "active", client_id: null, contract_id: null });
    fake.table("tasks").push({ id: "task-1", tenant_id: tenantId, project_id: "proj-1", title: "SEO改善", status: "blocked", assigned_agent_id: null, sequence: 1 });

    const ctx = makeCtx(fake, tenantId);
    const state = await getProjectRoomState(ctx, "proj-1");

    expect(state.deliveryGate.executionComplete).toBe(false);
    expect(state.deliveryGate.criticPassed).toBe(false);
    expect(state.progress.blockedTasks).toBe(1);
  });

  it("throws NotFound for a project belonging to another tenant", async () => {
    const fake = new FakeSupabase();
    fake.table("projects").push({ id: "proj-1", tenant_id: "tenant-a", name: "他社のプロジェクト", project_type: "seo_geo", status: "active", client_id: null, contract_id: null });

    const ctx = makeCtx(fake, "tenant-b");
    await expect(getProjectRoomState(ctx, "proj-1")).rejects.toThrow();
  });
});
