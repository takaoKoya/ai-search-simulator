import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { decideApproval } from "@/lib/server/approvals";
import { generateProposalFile } from "@/lib/server/documentGeneration";
import { createDeliveryPackage, sendDeliveryPackage } from "@/lib/server/deliveryPackage";
import { decodeBytea } from "@/lib/server/bytea";
import { verifySendPreconditions } from "@/lib/server/salesSendGate";
import { computeSlaForEvent } from "@/lib/server/slaEngine";
import type { TenantContext } from "@/lib/server/tenant";

function seedAgents(fake: FakeSupabase, tenantId: string) {
  const codes = [
    "research", "sales", "kuro", "contract", "taku", "qa", "repo", "seo", "geo", "mina", "kei",
    "scout", "sou", "scorer", "writer", "outreach", "analyst", "meeting", "proposal", "estimate", "negotiator", "rei",
  ];
  for (const code of codes) {
    fake.table("agents").push({ id: `agent-${tenantId}-${code}`, tenant_id: tenantId, code, name: code, role: code, provider: "template", model: null, status: "idle", capabilities: [], is_active: true });
  }
}

function makeCtx(fake: FakeSupabase, tenantId: string, userId = "user-1", role: TenantContext["role"] = "owner"): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId, userEmail: null, role };
}

/**
 * Phase 5 vertical slice: a proposal whose price crosses the high-amount
 * threshold goes through the Manager Approval Queue (manager step, then
 * ceo step — spec §51-53), gets reconciled against its estimate (spec
 * §46-48), rendered to a real CLIENT_VISIBLE PDF/PPTX only once approved
 * (spec §37-38), packaged for delivery, and sent (spec §48-49) — end to
 * end against the fake in-memory Supabase, no live network/DB required.
 */
describe("Phase 5 vertical slice: Manager Approval Queue -> Reconciliation -> Documents -> Delivery", () => {
  it("carries a high-value proposal through the full manager+ceo approval chain to a sent delivery package", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-p5";
    const supabase = fake as unknown as TenantContext["supabase"];
    seedAgents(fake, tenantId);

    fake.table("service_catalog").push(
      { id: "svc-seo", tenant_id: tenantId, code: "SEO", name: "SEO Standard", category: "SEO", pricing_model: "monthly", standard_price: 248000, setup_fee: 0, is_active: true },
      { id: "svc-aio", tenant_id: tenantId, code: "AIO", name: "AIO/GEO Standard", category: "AIO", pricing_model: "monthly", standard_price: 198000, setup_fee: 50000, is_active: true }
    );

    // Manager Approval Queue policies (mirrors the real seeded defaults).
    fake.table("approval_policies").push(
      { id: "pol-1", tenant_id: tenantId, code: "estimate_amount_low", conditions: { amountLt: 300000 }, steps: [{ role: "manager" }], is_active: true },
      { id: "pol-2", tenant_id: tenantId, code: "estimate_amount_high", conditions: { amountGte: 300000 }, steps: [{ role: "manager" }, { role: "ceo" }], is_active: true },
      { id: "pol-3", tenant_id: tenantId, code: "discount_low", conditions: { discountRateLte: 0.05 }, steps: [{ role: "manager" }], is_active: true },
      { id: "pol-4", tenant_id: tenantId, code: "discount_high", conditions: { discountRateGt: 0.05 }, steps: [{ role: "ceo" }], is_active: true }
    );

    const { data: leadRow } = await fake.from("leads").insert({ tenant_id: tenantId, company_name: "テスト株式会社", industry: "小売", domain: "test.example.jp" }).select("id").single();
    const leadId = (leadRow as { id: string }).id;

    const { data: oppRow } = await fake
      .from("opportunities")
      .insert({ tenant_id: tenantId, lead_id: leadId, stage: "NEEDS_ANALYSIS", services: [{ service: "SEO", reason: "自然検索改善" }, { service: "AIO", reason: "AI検索露出強化" }] })
      .select("id")
      .single();
    const opportunityId = (oppRow as { id: string }).id;

    const ctx = makeCtx(fake, tenantId);

    // 1. Proposal + Estimate Workflow generates a proposal whose combined
    // SEO+AIO estimate crosses the 300,000 high-amount threshold.
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
    const approvalId = proposalState.approvalRequestId as string;

    const approvalRow = fake.table("approval_requests").find((a) => a.id === approvalId)!;
    const steps = approvalRow.steps as Array<{ role: string; status?: string }>;
    expect(steps.map((s) => s.role)).toEqual(["manager", "ceo"]);
    expect(approvalRow.current_step).toBe(0);
    // The Reconciliation Engine ran and found a MATCH (SEO+AIO scope <->
    // SEO+AIO priced line items) — surfaced in the approval description.
    expect(approvalRow.description as string).toContain("Reconciliation: MATCH");

    // 2. Manager decides step 0 -> chain advances, does NOT finalize yet.
    const managerCtx = makeCtx(fake, tenantId, "user-manager", "manager");
    const stepResult = await decideApproval(managerCtx, approvalId, "approve");
    expect(stepResult.status).toBe("pending");
    const afterStep1 = fake.table("approval_requests").find((a) => a.id === approvalId)!;
    expect(afterStep1.current_step).toBe(1);
    expect((afterStep1.steps as Array<{ status?: string }>)[0].status).toBe("APPROVED");
    expect(fake.table("proposals").find((p) => p.id === proposalId)!.status).not.toBe("APPROVED");

    // A manager cannot jump ahead and decide the ceo's step.
    await expect(decideApproval(managerCtx, approvalId, "approve")).rejects.toThrow();

    // 3. CEO decides the final step -> finalizes: proposal becomes APPROVED,
    // content_json is now protected by the DB immutability trigger (not
    // simulated here — FakeSupabase doesn't enforce it, but the app-level
    // versioning path, tested separately, is the only way to change it now).
    const ceoCtx = makeCtx(fake, tenantId, "user-ceo", "ceo");
    const finalResult = await decideApproval(ceoCtx, approvalId, "approve");
    expect(finalResult.status).toBe("approved");
    const approvedProposal = fake.table("proposals").find((p) => p.id === proposalId)!;
    expect(approvedProposal.status).toBe("APPROVED");

    // 4. Real PDF + PPTX are only CLIENT_VISIBLE once approved.
    const pdfResult = await generateProposalFile(ctx, proposalId, "PDF");
    expect(pdfResult.classification).toBe("CLIENT_VISIBLE");
    const pdfFile = fake.table("generated_files").find((f) => f.id === pdfResult.fileId)!;
    expect(decodeBytea(pdfFile.file_data as string).subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const pptxResult = await generateProposalFile(ctx, proposalId, "PPTX");
    const pptxFile = fake.table("generated_files").find((f) => f.id === pptxResult.fileId)!;
    expect(decodeBytea(pptxFile.file_data as string).subarray(0, 2).toString("ascii")).toBe("PK");

    // 5. Delivery Package bundles only the CLIENT_VISIBLE files, then sends.
    const packageId = await createDeliveryPackage(ctx, { opportunityId, proposalId, coverMessage: "ご確認のほどよろしくお願いいたします。" });
    const pkg = fake.table("delivery_packages").find((p) => p.id === packageId)!;
    expect(pkg.attachment_file_ids).toEqual([pdfResult.fileId, pptxResult.fileId]);
    expect(pkg.status).toBe("DRAFT");

    await sendDeliveryPackage(ctx, packageId);
    expect(fake.table("delivery_packages").find((p) => p.id === packageId)!.status).toBe("SENT");
  });

  it("blocks the Final Send Gate when the approved content has changed since approval (Approval Snapshot Hash, spec §45)", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-p5-snapshot";
    const { computeSnapshotHash } = await import("@/lib/server/approvalSnapshot");
    const approvedFields = { to: "prospect@example.com", subject: "ご提案の件", body: "元の本文です。" };
    fake.table("approval_requests").push({ id: "appr-1", tenant_id: tenantId, snapshot_hash: computeSnapshotHash(approvedFields), expires_at: null });

    const ctx = makeCtx(fake, tenantId);
    const tamperedResult = await verifySendPreconditions(ctx, { to_address: approvedFields.to, subject: approvedFields.subject, body: "何者かに書き換えられた本文です。", lead_id: null, approval_request_id: "appr-1" });
    expect(tamperedResult.ok).toBe(false);
    expect(tamperedResult.reason).toBe("APPROVAL_INVALIDATED");

    const unchangedResult = await verifySendPreconditions(ctx, { ...approvedFields, to_address: approvedFields.to, lead_id: null, approval_request_id: "appr-1" });
    expect(unchangedResult.ok).toBe(true);
  });

  it("computes a Business-Time-aware SLA due date for a high-risk contract approval (spec §61-64)", async () => {
    const fake = new FakeSupabase();
    const tenantId = "tenant-p5-sla";
    fake.table("business_calendars").push({ id: "cal-1", tenant_id: tenantId, timezone: "Asia/Tokyo", working_days: [1, 2, 3, 4, 5], business_hours: { start: "09:00", end: "18:00" }, is_default: true });
    fake.table("sla_policies").push({ tenant_id: tenantId, entity_type: "approval_request", event_type: "contract_high_risk", priority: null, target_duration: 4, duration_unit: "business_hours", is_active: true });

    const startAt = new Date("2026-01-05T01:00:00Z"); // 10:00 JST, a Monday
    const sla = await computeSlaForEvent({ supabase: fake as unknown as TenantContext["supabase"], tenantId }, { entityType: "approval_request", eventType: "contract_high_risk", startAt });
    expect(sla).not.toBeNull();
    expect(sla!.dueAt.toISOString()).toBe(new Date("2026-01-05T05:00:00Z").toISOString()); // 14:00 JST, 4 business hours later
  });
});
