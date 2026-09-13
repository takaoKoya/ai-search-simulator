import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { decideApproval } from "@/lib/server/approvals";
import type { TenantContext } from "@/lib/server/tenant";

function seedAgents(fake: FakeSupabase, tenantId: string) {
  const codes = ["research", "sales", "kuro", "contract", "taku", "qa", "repo", "seo", "geo", "mina", "kei"];
  for (const code of codes) {
    fake.table("agents").push({ id: `agent-${code}`, tenant_id: tenantId, code, name: code, role: code, provider: "template", model: null, status: "idle" });
  }
}

function makeCtx(fake: FakeSupabase, tenantId: string, userId = "user-1", role: TenantContext["role"] = "owner"): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId, userEmail: null, role };
}

describe("decideApproval", () => {
  it("approving a sales_outreach approval moves the deal to WON and starts contract review", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    seedAgents(fake, tenantId);
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社", industry: "小売", status: "in_review" });
    fake.table("opportunities").push({ id: "opp-1", tenant_id: tenantId, lead_id: "lead-1", amount: 300000, status: "pending_approval" });
    fake.table("approval_requests").push({
      id: "appr-1",
      tenant_id: tenantId,
      type: "sales_outreach",
      subject_type: "opportunity",
      subject_id: "opp-1",
      title: "テスト株式会社への営業提案承認",
      status: "pending",
    });

    const ctx = makeCtx(fake, tenantId);
    const result = await decideApproval(ctx, "appr-1", "approve");
    expect(result.status).toBe("approved");

    const approvalRow = fake.table("approval_requests").find((a) => a.id === "appr-1")!;
    expect(approvalRow.status).toBe("approved");
    expect(approvalRow.decided_by_user_id).toBe("user-1");

    const opp = fake.table("opportunities").find((o) => o.id === "opp-1")!;
    expect(opp.status).toBe("won");

    const lead = fake.table("leads").find((l) => l.id === "lead-1")!;
    expect(lead.status).toBe("won");

    const contracts = fake.table("contracts");
    expect(contracts).toHaveLength(1);
    expect(contracts[0].status).toBe("pending_approval");
    expect(contracts[0].tenant_id).toBe(tenantId);

    const followUpApprovals = fake.table("approval_requests").filter((a) => a.type === "contract_approval");
    expect(followUpApprovals).toHaveLength(1);
  });

  it("rejecting a sales_outreach approval records the CEO's reason as a decision_memory", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    seedAgents(fake, tenantId);
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社", status: "in_review" });
    fake.table("opportunities").push({ id: "opp-1", tenant_id: tenantId, lead_id: "lead-1", status: "pending_approval" });
    fake.table("approval_requests").push({
      id: "appr-1",
      tenant_id: tenantId,
      type: "sales_outreach",
      subject_type: "opportunity",
      subject_id: "opp-1",
      title: "テスト株式会社への営業提案承認",
      status: "pending",
    });

    const ctx = makeCtx(fake, tenantId);
    const result = await decideApproval(ctx, "appr-1", "reject", "この価格では出さない");
    expect(result.status).toBe("rejected");

    const opp = fake.table("opportunities").find((o) => o.id === "opp-1")!;
    expect(opp.status).toBe("lost");
    const lead = fake.table("leads").find((l) => l.id === "lead-1")!;
    expect(lead.status).toBe("rejected");

    const memories = fake.table("decision_memories");
    expect(memories).toHaveLength(1);
    expect(memories[0].note).toBe("この価格では出さない");
    expect(memories[0].category).toBe("sales_outreach");

    // No follow-up graph should have run on rejection.
    expect(fake.table("contracts")).toHaveLength(0);
  });

  it("requires a reason for reject/revise but not for approve", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    seedAgents(fake, tenantId);
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社", status: "in_review" });
    fake.table("opportunities").push({ id: "opp-1", tenant_id: tenantId, lead_id: "lead-1", status: "pending_approval" });
    fake.table("approval_requests").push({
      id: "appr-1",
      tenant_id: tenantId,
      type: "sales_outreach",
      subject_type: "opportunity",
      subject_id: "opp-1",
      title: "x",
      status: "pending",
    });

    const ctx = makeCtx(fake, tenantId);
    await expect(decideApproval(ctx, "appr-1", "reject")).rejects.toThrow(/理由/);
    await expect(decideApproval(ctx, "appr-1", "revise", "   ")).rejects.toThrow(/理由/);
  });

  it("records an Edit-and-Approve note as a decision_memory without blocking approval", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    seedAgents(fake, tenantId);
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社", status: "in_review" });
    fake.table("opportunities").push({ id: "opp-1", tenant_id: tenantId, lead_id: "lead-1", amount: 300000, status: "pending_approval" });
    fake.table("approval_requests").push({
      id: "appr-1",
      tenant_id: tenantId,
      type: "sales_outreach",
      subject_type: "opportunity",
      subject_id: "opp-1",
      title: "x",
      status: "pending",
    });

    const ctx = makeCtx(fake, tenantId);
    const result = await decideApproval(ctx, "appr-1", "approve", undefined, "料金は据え置きで先方に伝えること");
    expect(result.status).toBe("approved");

    const memories = fake.table("decision_memories");
    expect(memories).toHaveLength(1);
    expect(memories[0].category).toBe("sales_outreach_edit");
    expect(memories[0].note).toBe("料金は据え置きで先方に伝えること");
  });

  it("refuses to re-decide an approval that is no longer pending", async () => {
    const fake = new FakeSupabase();
    fake.table("approval_requests").push({
      id: "appr-1",
      tenant_id: "t1",
      type: "sales_outreach",
      subject_type: "opportunity",
      subject_id: "opp-1",
      title: "x",
      status: "approved",
    });
    const ctx = makeCtx(fake, "t1");
    await expect(decideApproval(ctx, "appr-1", "approve")).rejects.toThrow();
  });
});
