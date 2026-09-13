import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { decideApproval } from "@/lib/server/approvals";
import { TestFixtureCandidateSource, type DiscoveredCandidate } from "@/lib/sales/candidateSource";
import { normalizeDomain } from "@/lib/sales/normalize";
import { DEFAULT_QUALIFICATION_THRESHOLDS, DEFAULT_SCORE_WEIGHTS } from "@/lib/sales/scoring";
import type { TenantContext } from "@/lib/server/tenant";

function seedAgents(fake: FakeSupabase, tenantId: string) {
  const codes = ["scout", "research", "sou", "scorer", "sales", "kuro", "writer"];
  for (const code of codes) {
    fake.table("agents").push({ id: `agent-${tenantId}-${code}`, tenant_id: tenantId, code, name: code, role: code, provider: "template", model: null, status: "idle" });
  }
}

function seedIcp(fake: FakeSupabase, tenantId: string, id: string, overrides: Record<string, unknown> = {}) {
  fake.table("icp_profiles").push({
    id,
    tenant_id: tenantId,
    target_industries: [],
    target_regions: ["全国"],
    target_services: [],
    requires_website: true,
    exclusion_conditions: [],
    score_weights: DEFAULT_SCORE_WEIGHTS,
    qualification_thresholds: DEFAULT_QUALIFICATION_THRESHOLDS,
    ...overrides,
  });
}

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "ceo-user", userEmail: "ceo@example.com", role: "owner" };
}

/**
 * Deterministically scores NURTURE (total 64, per lib/sales/scoring.ts's
 * seeded-hash formula) against a permissive ICP that never hard-excludes it —
 * used to exercise the "not qualified -> archived" branch without depending
 * on a specific named fixture's score landing in that band.
 */
const NURTURE_CANDIDATE: DiscoveredCandidate = {
  companyName: "イオタ興業",
  domain: null,
  websiteUrl: "https://5example.jp",
  industry: "サービス業",
  region: "全国",
  sourceType: "other",
  sourceUrl: null,
  sourceName: "Unit test candidate",
  discoveryReason: "[テストデータ] NURTURE帯を検証するための架空の候補企業",
  testMode: true,
};

/**
 * Exercises the AI Sales Department vertical slice (spec §81: one candidate
 * end-to-end before any batch discovery) against the fake in-memory
 * Supabase, covering the three seed scenarios from spec §61:
 *   A: qualifies -> CEO approves -> sales_draft_graph produces a DRAFT_READY draft.
 *   B: Do Not Contact blocks the candidate before it is ever scored.
 *   C (NURTURE_CANDIDATE above): scores below WARM -> archived/on-hold, never reaches a human.
 * No outreach is ever sent — the flow stops at a non-sent draft (§47/§50).
 */
describe("AI Sales Department: lead_discovery_graph vertical slice", () => {
  it("scenario A: qualifies, reaches CEO approval, and produces a non-sent draft on approval", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-sales-a";
    seedAgents(fake, tenantId);
    seedIcp(fake, tenantId, "icp-ab", { target_industries: ["不動産", "士業"], target_services: ["SEO", "AIO"] });

    const [candidate] = await new TestFixtureCandidateSource("A").discover(1);
    const finalState = await runBusinessGraph({
      supabase: fake as unknown as TenantContext["supabase"],
      tenantId,
      graphName: "lead_discovery_graph",
      subjectType: "icp_profile",
      subjectId: "icp-ab",
      input: { icpProfileId: "icp-ab", candidate },
    });

    expect(finalState.status).toBe("waiting_human");
    expect(finalState.approvalRequestId).toBeTruthy();
    const scoreResult = finalState.scoreResult as { total: number; qualification: string };
    expect(["HOT", "WARM"]).toContain(scoreResult.qualification);
    expect(scoreResult.total).toBeGreaterThanOrEqual(DEFAULT_QUALIFICATION_THRESHOLDS.warm);

    const leadId = finalState.leadId as string;
    const lead = fake.table("leads").find((l) => l.id === leadId)!;
    expect(lead.discovery_stage).toBe("APPROVAL_PENDING");
    expect(lead.duplicate_status).toBe("NEW");
    expect(lead.test_mode).toBe(true);
    expect(lead.ai_cost_yen).toBe(65); // basic_research(5)+website_check(8)+lead_scoring(2)+deep_research(30)+sales_hypothesis(15)+critic_review(5)

    const approval = fake.table("approval_requests").find((a) => a.id === finalState.approvalRequestId)!;
    expect(approval.type).toBe("sales_lead");
    expect(approval.subject_type).toBe("lead");
    expect(approval.subject_id).toBe(leadId);
    expect(approval.status).toBe("pending");

    const hypotheses = fake.table("lead_sales_hypotheses").filter((h) => h.lead_id === leadId);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].critic_status).toBe("PASS");
    expect((hypotheses[0].recommended_services as unknown[]).length).toBeGreaterThan(0);
    expect((hypotheses[0].recommended_services as unknown[]).length).toBeLessThanOrEqual(3);
    expect(hypotheses[0].price_recommendation).toBeNull(); // never fabricate a price table (spec §24)

    // CEO approves -> chains directly into sales_draft_graph.
    const ctx = makeCtx(fake, tenantId);
    const decision = await decideApproval(ctx, finalState.approvalRequestId as string, "approve");
    expect(decision.status).toBe("approved");

    const approvedLead = fake.table("leads").find((l) => l.id === leadId)!;
    expect(approvedLead.discovery_stage).toBe("READY_FOR_OUTREACH");
    expect(approvedLead.ai_cost_yen).toBe(80); // + sales_draft(10) + critic_review(5)

    const drafts = fake.table("sales_drafts").filter((d) => d.lead_id === leadId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("DRAFT_READY");
    expect(drafts[0].critic_status).toBe("PASS");
    expect(typeof drafts[0].body).toBe("string");
    expect((drafts[0].body as string).length).toBeGreaterThan(0);

    // The draft is content only — nothing in this pipeline ever sends it.
    const eventTypes = fake.table("agent_events").map((e) => e.event_type);
    expect(eventTypes).toContain("sales_hypothesis.created");
    expect(eventTypes).toContain("sales_draft.created");
    expect(eventTypes).toContain("sales_draft.ready");
    expect(eventTypes).not.toContain("sales_draft.sent");
    expect(eventTypes).not.toContain("outreach.sent");

    // Nothing here escaped this tenant.
    for (const table of ["leads", "lead_scores", "lead_sales_hypotheses", "sales_drafts", "approval_requests", "workflow_runs"]) {
      expect(fake.table(table).every((row) => row.tenant_id === tenantId)).toBe(true);
    }
  });

  it("scenario B: a Do Not Contact match blocks the candidate before it is ever scored", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-sales-b";
    seedAgents(fake, tenantId);
    seedIcp(fake, tenantId, "icp-ab", { target_industries: ["不動産", "士業"], target_services: ["SEO", "AIO"] });

    const [candidate] = await new TestFixtureCandidateSource("B").discover(1);
    const normalizedDomain = normalizeDomain(candidate.domain)!;
    fake.table("do_not_contact").push({ tenant_id: tenantId, normalized_domain: normalizedDomain, reason: "過去にクレーム対応が発生したため" });

    const finalState = await runBusinessGraph({
      supabase: fake as unknown as TenantContext["supabase"],
      tenantId,
      graphName: "lead_discovery_graph",
      subjectType: "icp_profile",
      subjectId: "icp-ab",
      input: { icpProfileId: "icp-ab", candidate },
    });

    expect(finalState.status).toBe("completed");
    expect(finalState.excluded).toBe(true);
    expect(finalState.duplicateStatus).toBe("BLOCKED");
    expect(finalState.approvalRequestId).toBeUndefined();
    expect(String(finalState.terminalReason)).toContain("Do Not Contact");

    const leadId = finalState.leadId as string;
    const lead = fake.table("leads").find((l) => l.id === leadId)!;
    expect(lead.discovery_stage).toBe("BLOCKED");
    expect(lead.status).toBe("rejected");

    // Scoring, research, and hypothesis generation never ran — the candidate
    // never reaches the point of even consuming an AI research call.
    expect(fake.table("lead_scores").filter((s) => s.lead_id === leadId)).toHaveLength(0);
    expect(fake.table("lead_sales_hypotheses").filter((h) => h.lead_id === leadId)).toHaveLength(0);
    expect(fake.table("findings").filter((f) => f.lead_id === leadId)).toHaveLength(0);
    expect(fake.table("approval_requests").filter((a) => a.subject_id === leadId)).toHaveLength(0);

    const eventTypes = fake.table("agent_events").map((e) => e.event_type);
    expect(eventTypes).toContain("lead.excluded");
  });

  it("scenario C: a below-WARM score is archived without ever reaching a human", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-sales-c";
    seedAgents(fake, tenantId);
    seedIcp(fake, tenantId, "icp-generic");

    const finalState = await runBusinessGraph({
      supabase: fake as unknown as TenantContext["supabase"],
      tenantId,
      graphName: "lead_discovery_graph",
      subjectType: "icp_profile",
      subjectId: "icp-generic",
      input: { icpProfileId: "icp-generic", candidate: NURTURE_CANDIDATE },
    });

    expect(finalState.status).toBe("completed");
    expect(finalState.approvalRequestId).toBeUndefined();
    const scoreResult = finalState.scoreResult as { total: number; qualification: string };
    expect(scoreResult.qualification).toBe("NURTURE");
    expect(scoreResult.total).toBe(64);
    expect(String(finalState.terminalReason)).toContain("NURTURE");

    const leadId = finalState.leadId as string;
    const lead = fake.table("leads").find((l) => l.id === leadId)!;
    expect(lead.discovery_stage).toBe("ON_HOLD");
    expect(lead.qualification).toBe("NURTURE");

    // Deep research / hypothesis / critic only run for HOT or WARM leads.
    expect(fake.table("lead_sales_hypotheses").filter((h) => h.lead_id === leadId)).toHaveLength(0);
    expect(fake.table("approval_requests").filter((a) => a.subject_id === leadId)).toHaveLength(0);

    const eventTypes = fake.table("agent_events").map((e) => e.event_type);
    expect(eventTypes).toContain("lead.archived");
  });
});
