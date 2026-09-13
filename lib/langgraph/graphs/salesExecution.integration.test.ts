import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { decideApproval } from "@/lib/server/approvals";
import { getEmailConnector } from "@/lib/sales/emailConnector";
import type { TenantContext } from "@/lib/server/tenant";

function seedAgents(fake: FakeSupabase, tenantId: string) {
  const codes = [
    "research", "sales", "kuro", "contract", "taku", "qa", "repo", "seo", "geo", "mina", "kei",
    "scout", "sou", "scorer", "writer", "outreach", "analyst", "meeting", "proposal", "estimate", "negotiator", "rei",
  ];
  for (const code of codes) {
    fake
      .table("agents")
      .push({ id: `agent-${tenantId}-${code}`, tenant_id: tenantId, code, name: code, role: code, provider: "template", model: null, status: "idle", capabilities: [], is_active: true });
  }
}

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "ceo-user", userEmail: "ceo@example.com", role: "owner" };
}

/**
 * Drives §94's full Phase 4 vertical slice against the fake in-memory
 * Supabase: a READY_FOR_OUTREACH lead (Phase 3's own output) all the way
 * through Outreach -> Send -> Reply -> Meeting Conversion -> Scheduling ->
 * Prep -> Minutes -> Proposal/Estimate -> Approval -> Send -> Negotiation ->
 * WON Gate -> deal_won approval -> the existing sales_graph/contract_graph
 * handoff (spec §56). No outreach send bypasses a human decision anywhere
 * on this path.
 */
describe("AI Sales Execution: Phase 4 vertical slice", () => {
  it("carries a READY_FOR_OUTREACH lead through to WON and into the existing Contract Workflow", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-p4";
    const supabase = fake as unknown as TenantContext["supabase"];
    seedAgents(fake, tenantId);

    fake.table("service_catalog").push({
      id: "svc-seo",
      tenant_id: tenantId,
      code: "SEO",
      name: "SEO Standard",
      category: "SEO",
      pricing_model: "monthly",
      standard_price: 248000,
      setup_fee: 0,
      is_active: true,
    });

    const { data: leadRow } = await fake
      .from("leads")
      .insert({
        tenant_id: tenantId,
        company_name: "株式会社ベルタ商事",
        industry: "小売",
        region: "東京都",
        website: "https://beruta-shoji.example.jp",
        domain: "beruta-shoji.example.jp",
        normalized_domain: "beruta-shoji.example.jp",
        status: "approved",
        discovery_stage: "READY_FOR_OUTREACH",
        test_mode: true,
        ai_cost_yen: 0,
      })
      .select("id")
      .single();
    const leadId = (leadRow as { id: string }).id;

    await fake.from("lead_sales_hypotheses").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      observed_problem: "問い合わせ導線が電話中心でWeb完結していない",
      business_impact: "問い合わせ機会を逃している可能性がある",
      why_now: "サイトが長期間更新されていない",
      recommended_services: [{ service: "SEO", reason: "自然検索からの流入改善余地が大きい" }],
      expected_outcome: "問い合わせ数の増加",
      confidence: "MEDIUM",
      estimated_initial_value: 150000,
      estimated_monthly_value: 248000,
      estimated_annual_value: 2976000,
      critic_status: "PASS",
    });

    await fake.from("findings").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      type: "website_diagnosis_lite",
      payload: { checks: { monthsSinceLastUpdate: 12 } },
    });

    const ctx = makeCtx(fake, tenantId);

    // 1. Sales Outreach Workflow: Draft -> Critic -> Human Approval.
    const outreachState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "sales_outreach_prep_graph",
      subjectType: "lead",
      subjectId: leadId,
      input: { leadId },
    });
    expect(outreachState.status).toBe("waiting_human");
    const sendApprovalId = outreachState.approvalRequestId as string;
    expect(sendApprovalId).toBeTruthy();

    const outreachMessageId = outreachState.messageId as string;
    expect(fake.table("sales_messages").find((m) => m.id === outreachMessageId)!.status).toBe("WAITING_APPROVAL");

    // 2. CEO approves -> Create External Draft (automatic, not a send).
    const approveOutreach = await decideApproval(ctx, sendApprovalId, "approve");
    expect(approveOutreach.status).toBe("approved");
    const readyMessage = fake.table("sales_messages").find((m) => m.id === outreachMessageId)!;
    expect(readyMessage.status).toBe("READY_TO_SEND");
    expect(readyMessage.provider).toBe("simulated_gmail");

    // 3. Final Send Gate (human clicks Send Now) — replicated inline since
    // this logic lives in a Next.js route handler, not a lib/ function.
    const connector = getEmailConnector();
    const sendResult = await connector.send(
      { to: readyMessage.to_address as string, subject: readyMessage.subject as string, body: readyMessage.body as string },
      `send-${outreachMessageId}`
    );
    await fake
      .from("sales_messages")
      .update({ status: "SENT", sent_at: sendResult.sentAt, provider_message_id: sendResult.providerMessageId, provider_thread_id: sendResult.providerThreadId })
      .eq("id", outreachMessageId)
      .eq("tenant_id", tenantId);
    await fake.from("leads").update({ discovery_stage: "CONTACTED" }).eq("id", leadId).eq("tenant_id", tenantId);
    expect(fake.table("leads").find((l) => l.id === leadId)!.discovery_stage).toBe("CONTACTED");

    // 4. Test-mode reply arrives, requesting a meeting -> classification,
    // Meeting Conversion (Opportunity created), Reply Draft + approval.
    const replyState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "reply_analysis_graph",
      subjectType: "sales_message",
      subjectId: outreachMessageId,
      input: { originalMessageId: outreachMessageId, replyText: "ご連絡ありがとうございます。ぜひ一度、商談のお時間をいただけますでしょうか。" },
    });
    expect(replyState.status).toBe("waiting_human");
    expect(replyState.classification).toBe("MEETING_REQUEST");
    const opportunityId = replyState.opportunityId as string;
    expect(opportunityId).toBeTruthy();
    expect(fake.table("opportunities").find((o) => o.id === opportunityId)!.stage).toBe("MEETING");

    const replyApprovalId = replyState.approvalRequestId as string;
    const approveReply = await decideApproval(ctx, replyApprovalId, "approve");
    expect(approveReply.status).toBe("approved");

    // 5. Meeting Scheduling: AI proposes slots, human selects one (replicating
    // the select-time route's calendar-event + status transition).
    const schedulingState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "meeting_scheduling_graph",
      subjectType: "opportunity",
      subjectId: opportunityId,
      input: { opportunityId, companyName: "株式会社ベルタ商事" },
    });
    const meetingId = schedulingState.meetingId as string;
    const candidateTimes = schedulingState.candidateTimes as Array<{ start: string; end: string }>;
    expect(candidateTimes.length).toBeGreaterThan(0);

    const chosen = candidateTimes[0];
    await fake
      .from("meetings")
      .update({ status: "SCHEDULED", scheduled_at: chosen.start, duration_minutes: 45, calendar_event_id: "evt_test", calendar_provider: "simulated_calendar" })
      .eq("id", meetingId)
      .eq("tenant_id", tenantId);

    // 6. Meeting Prep.
    const prepState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "meeting_prep_graph",
      subjectType: "meeting",
      subjectId: meetingId,
      input: { meetingId },
    });
    expect(prepState.status).toBe("completed");
    expect((fake.table("meetings").find((m) => m.id === meetingId)!.agenda as unknown[]).length).toBeGreaterThan(0);

    // 7. Transcript -> Minutes Draft -> Human Review (Opportunity update).
    await fake
      .from("meetings")
      .update({
        transcript:
          "本日はお時間をいただきありがとうございました。現在の課題は問い合わせ数の少なさです。予算は月50万円程度を想定しています。決裁者は山田部長です。導入時期は来月を希望されています。",
        transcript_status: "PROVIDED",
      })
      .eq("id", meetingId)
      .eq("tenant_id", tenantId);

    const minutesState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "meeting_minutes_graph",
      subjectType: "meeting",
      subjectId: meetingId,
      input: { meetingId },
    });
    expect(minutesState.status).toBe("completed");
    const meetingRow = fake.table("meetings").find((m) => m.id === meetingId)!;
    expect(meetingRow.minutes_status).toBe("DRAFT");

    // Human confirms minutes (replicating the confirm route).
    const minutes = meetingRow.minutes as Record<string, unknown>;
    expect(minutes.authority).not.toBe("UNASSIGNED"); // decision maker was in the transcript
    await fake
      .from("opportunities")
      .update({ stage: "NEEDS_ANALYSIS", decision_maker: minutes.authority, budget: minutes.budget, timeline: minutes.timing, qualification: minutes })
      .eq("id", opportunityId)
      .eq("tenant_id", tenantId);
    await fake.from("meetings").update({ minutes_status: "HUMAN_REVIEWED", status: "COMPLETED" }).eq("id", meetingId).eq("tenant_id", tenantId);

    // 8. Proposal + Estimate Workflow.
    const proposalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "proposal_draft_graph",
      subjectType: "opportunity",
      subjectId: opportunityId,
      input: { opportunityId },
    });
    expect(proposalState.status).toBe("waiting_human");
    const proposalId = proposalState.proposalId as string;
    const estimateId = proposalState.estimateId as string;
    expect(proposalId).toBeTruthy();
    expect(estimateId).toBeTruthy();
    expect(proposalState.unmatchedServices).toEqual([]); // SEO matched the seeded catalog
    const estimateRow = fake.table("estimates").find((e) => e.id === estimateId)!;
    expect(estimateRow.total).toBeGreaterThan(0);

    const proposalApprovalId = proposalState.approvalRequestId as string;
    const approveProposal = await decideApproval(ctx, proposalApprovalId, "approve");
    expect(approveProposal.status).toBe("approved");
    const approvedProposal = fake.table("proposals").find((p) => p.id === proposalId)!;
    expect(approvedProposal.status).toBe("APPROVED");
    expect(approvedProposal.price_summary).toBeTruthy(); // estimate snapshot fixed at approval time

    // 9. Human sends the proposal (replicating the send route).
    await fake.from("proposals").update({ status: "SENT", sent_at: new Date().toISOString() }).eq("id", proposalId).eq("tenant_id", tenantId);
    await fake.from("opportunities").update({ stage: "PROPOSAL_SENT" }).eq("id", opportunityId).eq("tenant_id", tenantId);

    // 10. Negotiation: client accepts outright.
    const negotiationState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "negotiation_analysis_graph",
      subjectType: "opportunity",
      subjectId: opportunityId,
      input: { opportunityId, reactionCategory: "APPROVED" },
    });
    expect(negotiationState.status).toBe("completed");
    expect(fake.table("opportunities").find((o) => o.id === opportunityId)!.stage).toBe("NEGOTIATION");
    const negotiationFindings = fake.table("findings").filter((f) => f.type === "negotiation_item");
    expect(negotiationFindings).toHaveLength(1);

    // 11. WON Gate: checklist passes (Proposal Sent, Decision Maker, Client
    // Intent Confirmed) -> creates the deal_won CEO approval.
    const wonGateState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "deal_won_gate_graph",
      subjectType: "opportunity",
      subjectId: opportunityId,
      input: { opportunityId, clientIntentConfirmed: true },
    });
    expect(wonGateState.status).toBe("waiting_human");
    expect(wonGateState.missingChecks).toEqual([]);
    const dealWonApprovalId = wonGateState.approvalRequestId as string;
    expect(dealWonApprovalId).toBeTruthy();

    // 12. CEO confirms WON -> reuses the existing sales_graph/contract_graph
    // chain unchanged (spec §55-56).
    const wonDecision = await decideApproval(ctx, dealWonApprovalId, "approve");
    expect(wonDecision.status).toBe("approved");

    const finalOpp = fake.table("opportunities").find((o) => o.id === opportunityId)!;
    expect(finalOpp.status).toBe("won");
    expect(finalOpp.stage).toBe("WON");
    const finalLead = fake.table("leads").find((l) => l.id === leadId)!;
    expect(finalLead.status).toBe("won");

    const contract = fake.table("contracts").find((c) => c.opportunity_id === opportunityId);
    expect(contract).toBeTruthy();
    expect(contract!.status).toBe("pending_approval");
    const contractApproval = fake.table("approval_requests").find((a) => a.type === "contract_approval" && a.subject_id === contract!.id);
    expect(contractApproval).toBeTruthy();
    expect(contractApproval!.status).toBe("pending");

    // Every table this run touched stayed scoped to this tenant.
    for (const table of [
      "leads", "lead_sales_hypotheses", "sales_conversations", "sales_messages", "opportunities",
      "meetings", "proposals", "estimates", "findings", "approval_requests", "contracts", "workflow_runs",
    ]) {
      expect(fake.table(table).every((row) => row.tenant_id === tenantId)).toBe(true);
    }
  });
});
