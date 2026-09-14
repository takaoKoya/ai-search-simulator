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

  describe("Manager Approval Queue (step-based authorization)", () => {
    it("lets a manager approve the step assigned to them, advancing the chain without finalizing", async () => {
      const fake = new FakeSupabase();
      const tenantId = "t1";
      fake.table("approval_requests").push({
        id: "appr-1",
        tenant_id: tenantId,
        type: "proposal_approval",
        subject_type: "proposal",
        subject_id: "prop-1",
        title: "見積承認",
        status: "pending",
        steps: [{ role: "manager", status: "PENDING" }, { role: "ceo", status: "PENDING" }],
        current_step: 0,
      });

      const managerCtx = makeCtx(fake, tenantId, "user-manager", "manager");
      const result = await decideApproval(managerCtx, "appr-1", "approve");
      expect(result.status).toBe("pending");

      const row = fake.table("approval_requests").find((a) => a.id === "appr-1")!;
      expect(row.status).toBe("pending");
      expect(row.current_step).toBe(1);
      const steps = row.steps as Array<{ role: string; status: string }>;
      expect(steps[0].status).toBe("APPROVED");
      expect(steps[1].status).toBe("PENDING");
    });

    it("blocks a manager from deciding a step assigned to a different role", async () => {
      const fake = new FakeSupabase();
      const tenantId = "t1";
      fake.table("approval_requests").push({
        id: "appr-1",
        tenant_id: tenantId,
        type: "proposal_approval",
        subject_type: "proposal",
        subject_id: "prop-1",
        title: "見積承認",
        status: "pending",
        steps: [{ role: "ceo", status: "PENDING" }],
        current_step: 0,
      });

      const managerCtx = makeCtx(fake, tenantId, "user-manager", "manager");
      await expect(decideApproval(managerCtx, "appr-1", "approve")).rejects.toThrow();
    });

    it("blocks a plain member from deciding any step-chained approval", async () => {
      const fake = new FakeSupabase();
      const tenantId = "t1";
      fake.table("approval_requests").push({
        id: "appr-1",
        tenant_id: tenantId,
        type: "sales_send",
        subject_type: "sales_message",
        subject_id: "msg-1",
        title: "送信承認",
        status: "pending",
        steps: [{ role: "manager", status: "PENDING" }],
        current_step: 0,
      });

      const memberCtx = makeCtx(fake, tenantId, "user-member", "member");
      await expect(decideApproval(memberCtx, "appr-1", "approve")).rejects.toThrow();
    });

    it("lets a ceo override a step assigned to manager, advancing the chain like a normal step-approve", async () => {
      // Superuser override means the role check never blocks owner/ceo/admin
      // — it does not mean they can skip ahead of a chain that isn't at its
      // final step yet. A ceo approving step 0 of a 2-step chain still just
      // advances to step 1 (where, in this vertical slice, ceo would go on
      // to approve again) rather than finalizing early.
      const fake = new FakeSupabase();
      const tenantId = "t1";
      fake.table("approval_requests").push({
        id: "appr-1",
        tenant_id: tenantId,
        type: "proposal_approval",
        subject_type: "proposal",
        subject_id: "prop-1",
        title: "見積承認",
        status: "pending",
        steps: [{ role: "manager", status: "PENDING" }, { role: "ceo", status: "PENDING" }],
        current_step: 0,
      });

      const ceoCtx = makeCtx(fake, tenantId, "user-ceo", "ceo");
      const result = await decideApproval(ceoCtx, "appr-1", "approve");
      expect(result.status).toBe("pending");

      const row = fake.table("approval_requests").find((a) => a.id === "appr-1")!;
      expect(row.status).toBe("pending");
      expect(row.current_step).toBe(1);
      const steps = row.steps as Array<{ role: string; status: string }>;
      expect(steps[0].status).toBe("APPROVED");
      expect(steps[1].status).toBe("PENDING");
    });

    it("lets the ceo finalize the final step, marking earlier manager steps CANCELLED on reject", async () => {
      const fake = new FakeSupabase();
      const tenantId = "t1";
      fake.table("approval_requests").push({
        id: "appr-1",
        tenant_id: tenantId,
        type: "proposal_approval",
        subject_type: "proposal",
        subject_id: "prop-1",
        title: "見積承認",
        status: "pending",
        steps: [{ role: "manager", status: "APPROVED" }, { role: "ceo", status: "PENDING" }],
        current_step: 1,
      });

      const ceoCtx = makeCtx(fake, tenantId, "user-ceo", "ceo");
      const result = await decideApproval(ceoCtx, "appr-1", "reject", "価格見直しが必要");
      expect(result.status).toBe("rejected");

      const row = fake.table("approval_requests").find((a) => a.id === "appr-1")!;
      const steps = row.steps as Array<{ role: string; status: string }>;
      expect(steps[0].status).toBe("APPROVED");
      expect(steps[1].status).toBe("REJECTED");
    });
  });
});
