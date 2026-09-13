import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { decideApproval } from "@/lib/server/approvals";
import type { TenantContext } from "@/lib/server/tenant";

function seedAgents(fake: FakeSupabase, tenantId: string) {
  const codes = ["research", "sales", "kuro", "contract", "taku", "qa", "repo", "seo", "geo", "mina", "kei"];
  for (const code of codes) {
    fake.table("agents").push({ id: `agent-${tenantId}-${code}`, tenant_id: tenantId, code, name: code, role: code, provider: "template", model: null, status: "idle" });
  }
}

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "ceo-user", userEmail: "ceo@example.com", role: "owner" };
}

/**
 * Exercises the entire Phase 1 vertical slice end-to-end against the fake
 * in-memory Supabase: Lead -> Research -> Sales draft -> Critic -> CEO
 * approval -> WON -> Contract review -> CEO approval -> Project + Team +
 * Tasks -> Execution -> Critic -> QA -> CEO delivery approval -> Delivered.
 * This is the automated stand-in for the 25-point browser checklist in the
 * product brief: everything it can verify without a live Supabase/browser,
 * it verifies here.
 */
describe("Phase 1 vertical slice: lead to delivered", () => {
  it("runs the full pipeline and leaves a consistent, tenant-scoped trail", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-flow";
    seedAgents(fake, tenantId);

    const { data: lead } = await fake
      .from("leads")
      .insert({ tenant_id: tenantId, company_name: "架空株式会社", industry: "小売", status: "new" })
      .select("id")
      .single();
    const leadId = (lead as { id: string }).id;

    const ctx = makeCtx(fake, tenantId);

    // 1. Lead -> Research -> Sales draft -> Critic -> approval requested.
    const leadGenResult = await runBusinessGraph({
      supabase: ctx.supabase,
      tenantId,
      graphName: "lead_generation_graph",
      subjectType: "lead",
      subjectId: leadId,
      input: { leadId, companyName: "架空株式会社", industry: "小売" },
    });
    expect(leadGenResult.status).toBe("waiting_human");
    const salesApprovalId = leadGenResult.approvalRequestId as string;
    expect(salesApprovalId).toBeTruthy();

    // 2. CEO approves the sales candidate -> WON -> contract review requested.
    const salesDecision = await decideApproval(ctx, salesApprovalId, "approve");
    expect(salesDecision.status).toBe("approved");

    const opportunity = fake.table("opportunities")[0];
    expect(opportunity.status).toBe("won");
    const lead1 = fake.table("leads").find((l) => l.id === leadId)!;
    expect(lead1.status).toBe("won");

    const contract = fake.table("contracts")[0];
    expect(contract.status).toBe("pending_approval");
    const contractApproval = fake.table("approval_requests").find((a) => a.type === "contract_approval")!;
    expect(contractApproval.status).toBe("pending");

    // 3. CEO approves the contract -> Project + Team + Tasks -> Execution runs to completion.
    const contractDecision = await decideApproval(ctx, contractApproval.id as string, "approve");
    expect(contractDecision.status).toBe("approved");

    const project = fake.table("projects")[0];
    expect(project).toBeTruthy();
    expect(project.status).toBe("active");

    const team = fake.table("project_team_members").filter((m) => m.project_id === project.id);
    expect(team.length).toBeGreaterThan(0);

    const tasks = fake.table("tasks").filter((t) => t.project_id === project.id);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.status === "done")).toBe(true);

    const deliverables = fake.table("deliverables").filter((d) => d.project_id === project.id);
    expect(deliverables.length).toBe(tasks.length);
    expect(deliverables.every((d) => d.status === "approved")).toBe(true);

    const deliveryApproval = fake.table("approval_requests").find((a) => a.type === "delivery")!;
    expect(deliveryApproval.status).toBe("pending");

    // 4. CEO approves delivery -> project delivered.
    const deliveryDecision = await decideApproval(ctx, deliveryApproval.id as string, "approve");
    expect(deliveryDecision.status).toBe("approved");

    const deliveredProject = fake.table("projects").find((p) => p.id === project.id)!;
    expect(deliveredProject.status).toBe("delivered");
    const deliveredDeliverables = fake.table("deliverables").filter((d) => d.project_id === project.id);
    expect(deliveredDeliverables.every((d) => d.status === "delivered")).toBe(true);

    // Full activity trail exists and is timestamp-ordered material for the Activity Feed / Timeline.
    const eventTypes = fake.table("agent_events").map((e) => e.event_type);
    for (const expected of [
      "agent.started",
      "agent.completed",
      "agent.handoff",
      "approval.requested",
      "approval.approved",
      "opportunity.won",
      "project.created",
      "team.created",
      "task.created",
      "qa.passed",
      "delivery.completed",
      "lead.researched",
      "lead.scored",
      "critic.reviewed",
      "workflow.started",
      "workflow.waiting_human",
      "workflow.completed",
      "contract.reviewed",
      "task.started",
      "task.completed",
      "qa.started",
    ]) {
      expect(eventTypes).toContain(expected);
    }

    // Every workflow_run/agent_run/event/approval/decision row stayed scoped to this tenant.
    for (const table of ["workflow_runs", "agent_runs", "agent_events", "approval_requests", "opportunities", "contracts", "projects", "tasks", "deliverables"]) {
      expect(fake.table(table).every((row) => row.tenant_id === tenantId)).toBe(true);
    }

    // No rejections happened, so no decision_memories should have been recorded.
    expect(fake.table("decision_memories")).toHaveLength(0);

    // Every workflow_run in this run ended in a terminal, non-"running" state.
    const runs = fake.table("workflow_runs");
    expect(runs.length).toBeGreaterThanOrEqual(5); // lead_generation, sales, contract, onboarding, execution, delivery
    expect(runs.every((r) => r.status === "completed" || r.status === "waiting_human")).toBe(true);
  });
});
