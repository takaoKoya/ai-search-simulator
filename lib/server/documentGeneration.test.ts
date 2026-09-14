import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { generateProposalFile } from "@/lib/server/documentGeneration";
import { decodeBytea } from "@/lib/server/bytea";
import type { TenantContext } from "@/lib/server/tenant";

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "user-1", userEmail: null, role: "owner" };
}

const SAMPLE_CONTENT_JSON = {
  title: "テスト提案書",
  executiveSummary: "サマリー",
  clientChallenges: ["課題A"],
  goals: ["目標A"],
  recommendedSolution: "SEO施策",
  scope: ["SEO"],
  deliverables: ["月次レポート"],
  timeline: [{ phase: "初期設定", period: "1ヶ月目" }],
  kpis: ["問い合わせ数"],
  nextStep: "見積確認",
};

describe("generateProposalFile", () => {
  it("classifies the file INTERNAL when the proposal is still DRAFT", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("opportunities").push({ id: "opp-1", tenant_id: tenantId, lead_id: "lead-1" });
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, opportunity_id: "opp-1", status: "DRAFT", content_json: SAMPLE_CONTENT_JSON });

    const ctx = makeCtx(fake, tenantId);
    const result = await generateProposalFile(ctx, "prop-1", "PDF");
    expect(result.classification).toBe("INTERNAL");

    const fileRow = fake.table("generated_files").find((f) => f.id === result.fileId)!;
    expect(fileRow.classification).toBe("INTERNAL");
    expect(fileRow.file_type).toBe("PDF");
    const bytes = decodeBytea(fileRow.file_data as string);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("classifies the file CLIENT_VISIBLE once the proposal is APPROVED", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("opportunities").push({ id: "opp-1", tenant_id: tenantId, lead_id: "lead-1" });
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, opportunity_id: "opp-1", status: "APPROVED", content_json: SAMPLE_CONTENT_JSON });

    const ctx = makeCtx(fake, tenantId);
    const result = await generateProposalFile(ctx, "prop-1", "PPTX");
    expect(result.classification).toBe("CLIENT_VISIBLE");

    const fileRow = fake.table("generated_files").find((f) => f.id === result.fileId)!;
    const bytes = decodeBytea(fileRow.file_data as string);
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("includes the estimate's line items when an estimate exists", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("opportunities").push({ id: "opp-1", tenant_id: tenantId, lead_id: "lead-1" });
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, opportunity_id: "opp-1", status: "APPROVED", content_json: SAMPLE_CONTENT_JSON });
    fake.table("estimates").push({
      id: "est-1",
      tenant_id: tenantId,
      proposal_id: "prop-1",
      content_json: { lineItems: [{ service: "SEO Standard", unitPrice: 248000, amount: 248000 }], subtotal: 248000, discount: 0, tax: 24800, total: 272800 },
    });

    const ctx = makeCtx(fake, tenantId);
    const result = await generateProposalFile(ctx, "prop-1", "PDF");
    const fileRow = fake.table("generated_files").find((f) => f.id === result.fileId)!;
    expect(decodeBytea(fileRow.file_data as string).length).toBeGreaterThan(500);
  });

  it("throws when the proposal has no content_json yet", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, opportunity_id: "opp-1", status: "DRAFT", content_json: null });
    const ctx = makeCtx(fake, tenantId);
    await expect(generateProposalFile(ctx, "prop-1", "PDF")).rejects.toThrow();
  });
});
