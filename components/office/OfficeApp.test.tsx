/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OfficeApp from "@/components/office/OfficeApp";
import type { OfficeState } from "@/lib/server/officeState";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function buildState(): OfficeState {
  const agentResearch = {
    id: "agent-research",
    code: "research",
    name: "リサーチ",
    role: "company_research",
    job_title: "Company Research",
    status: "idle",
    avatar: null,
    notificationCount: 0,
    current_project_id: null,
    current_task_id: null,
    is_active: true,
  };
  const agentSales = {
    id: "agent-sales",
    code: "sales",
    name: "セール",
    role: "sales_strategy",
    job_title: "Sales Strategy",
    status: "working",
    avatar: null,
    notificationCount: 0,
    current_project_id: null,
    current_task_id: null,
    is_active: true,
  };

  return {
    departments: [
      {
        id: "dept-sales",
        code: "sales",
        name: "営業部",
        sort_order: 1,
        agents: [agentResearch, agentSales],
        stats: { activeCount: 1, totalCount: 2, activeProjectCount: 0, pendingApprovalCount: 1, warningCount: 0 },
      },
    ],
    unassignedAgents: [],
    agents: [agentResearch, agentSales],
    approvals: [
      {
        id: "appr-1",
        type: "sales_outreach",
        subject_type: "opportunity",
        subject_id: "opp-1",
        title: "テスト株式会社への営業提案承認",
        description: "提案内容...",
        risk_level: "LOW",
        ai_recommendation: "承認を推奨",
        status: "pending",
        created_at: new Date().toISOString(),
      },
    ],
    pendingApprovals: [
      {
        id: "appr-1",
        type: "sales_outreach",
        subject_type: "opportunity",
        subject_id: "opp-1",
        title: "テスト株式会社への営業提案承認",
        description: "提案内容...",
        risk_level: "LOW",
        ai_recommendation: "承認を推奨",
        status: "pending",
        created_at: new Date().toISOString(),
      },
    ],
    events: [
      { id: "evt-1", event_type: "agent.started", message: "リサーチが調査を開始", payload: {}, from_agent_id: null, to_agent_id: "agent-research", created_at: new Date().toISOString(), fromAgentName: null, toAgentName: "リサーチ" },
    ],
    workflowRuns: [
      { id: "wf-1", graph_name: "lead_generation_graph", subject_type: "lead", subject_id: "lead-1", status: "waiting_human", current_node: "request_approval", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ],
    projects: [],
    tasks: [],
    leads: [{ id: "lead-1", company_name: "テスト株式会社", industry: "小売", status: "in_review", score: 50, created_at: new Date().toISOString() }],
    ceoSummary: { byType: [{ type: "sales_outreach", label: "営業承認", count: 1 }], totalPending: 1, estimatedMinutesToday: null },
  } as unknown as OfficeState;
}

describe("OfficeApp", () => {
  it("renders the Office board, department agents, and pending approval badge without crashing", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(buildState()) }))
    );

    render(<OfficeApp initialState={buildState()} role="owner" tenantName="テストテナント" />);

    expect(screen.getByText("AI Office")).toBeTruthy();
    expect(screen.getAllByText("営業部").length).toBeGreaterThan(0);
    expect(screen.getAllByText("リサーチ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("セール").length).toBeGreaterThan(0);
    // Pending-approval badge count on the CEO Seat button.
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });
});
