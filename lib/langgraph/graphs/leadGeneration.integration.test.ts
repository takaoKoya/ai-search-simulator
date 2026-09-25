import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import type { SupabaseServerClient } from "@/lib/server/tenant";

function seedAgents(fake: FakeSupabase, tenantId: string) {
  const codes = ["research", "sales", "kuro", "contract", "taku", "qa", "repo", "seo", "geo", "mina", "kei"];
  for (const code of codes) {
    fake.table("agents").push({
      id: `agent-${code}`,
      tenant_id: tenantId,
      code,
      name: code,
      role: code,
      provider: "template",
      model: null,
      status: "idle",
    });
  }
}

describe("lead_generation_graph via BusinessOrchestrator", () => {
  it("runs research -> sales -> critic -> approval and persists every step", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-1";
    seedAgents(fake, tenantId);
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社", industry: "小売", status: "new" });

    const supabase = fake as unknown as SupabaseServerClient;
    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "lead_generation_graph",
      subjectType: "lead",
      subjectId: "lead-1",
      input: { leadId: "lead-1", companyName: "テスト株式会社", industry: "小売" },
    });

    expect(finalState.status).toBe("waiting_human");
    expect(finalState.opportunityId).toBeTruthy();
    expect(finalState.approvalRequestId).toBeTruthy();

    const opportunities = fake.table("opportunities");
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].status).toBe("pending_approval");
    expect(opportunities[0].tenant_id).toBe(tenantId);

    const approvals = fake.table("approval_requests");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].type).toBe("sales_outreach");
    expect(approvals[0].status).toBe("pending");

    const events = fake.table("agent_events");
    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain("agent.started");
    expect(eventTypes).toContain("agent.completed");
    expect(eventTypes).toContain("agent.handoff");
    expect(eventTypes).toContain("approval.requested");

    const workflowRuns = fake.table("workflow_runs");
    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0].status).toBe("waiting_human");
    expect(workflowRuns[0].graph_name).toBe("lead_generation_graph");

    const leads = fake.table("leads");
    expect(leads[0].status).toBe("in_review");

    const findings = fake.table("findings");
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("company_research");
  });

  it("keeps everything scoped to the acting tenant", async () => {
    const fake = new FakeSupabase();
    seedAgents(fake, "tenant-a");
    seedAgents(fake, "tenant-b");
    fake.table("leads").push({ id: "lead-a", tenant_id: "tenant-a", company_name: "A社", industry: "IT", status: "new" });

    const supabase = fake as unknown as SupabaseServerClient;
    await runBusinessGraph({
      supabase,
      tenantId: "tenant-a",
      graphName: "lead_generation_graph",
      subjectType: "lead",
      subjectId: "lead-a",
      input: { leadId: "lead-a", companyName: "A社", industry: "IT" },
    });

    const opportunities = fake.table("opportunities");
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].tenant_id).toBe("tenant-a");
    // Nothing should have been written against tenant-b's rows.
    expect(fake.table("workflow_runs").every((r) => r.tenant_id === "tenant-a")).toBe(true);
  });
});
