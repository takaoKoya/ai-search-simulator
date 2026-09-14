import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { computeSnapshotHash } from "@/lib/server/approvalSnapshot";
import { verifySendPreconditions } from "@/lib/server/salesSendGate";
import type { TenantContext } from "@/lib/server/tenant";

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "user-1", userEmail: null, role: "owner" };
}

describe("verifySendPreconditions", () => {
  it("passes when there is no linked approval_request_id (nothing to re-verify)", async () => {
    const fake = new FakeSupabase();
    const ctx = makeCtx(fake, "t1");
    const result = await verifySendPreconditions(ctx, { to_address: "x@example.com", subject: "Hi", body: "Body", lead_id: null, approval_request_id: null });
    expect(result.ok).toBe(true);
  });

  it("passes when content still matches the approval's snapshot hash", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    const fields = { to: "x@example.com", subject: "Hi", body: "Body" };
    fake.table("approval_requests").push({ id: "appr-1", tenant_id: tenantId, snapshot_hash: computeSnapshotHash(fields), expires_at: null });

    const ctx = makeCtx(fake, tenantId);
    const result = await verifySendPreconditions(ctx, { to_address: "x@example.com", subject: "Hi", body: "Body", lead_id: null, approval_request_id: "appr-1" });
    expect(result.ok).toBe(true);
  });

  it("fails with APPROVAL_INVALIDATED when the recipient changed since approval", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    const approvedFields = { to: "x@example.com", subject: "Hi", body: "Body" };
    fake.table("approval_requests").push({ id: "appr-1", tenant_id: tenantId, snapshot_hash: computeSnapshotHash(approvedFields), expires_at: null });

    const ctx = makeCtx(fake, tenantId);
    const result = await verifySendPreconditions(ctx, { to_address: "attacker@example.com", subject: "Hi", body: "Body", lead_id: null, approval_request_id: "appr-1" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("APPROVAL_INVALIDATED");
  });

  it("fails with APPROVAL_EXPIRED when the approval's expires_at has passed", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    const fields = { to: "x@example.com", subject: "Hi", body: "Body" };
    fake.table("approval_requests").push({ id: "appr-1", tenant_id: tenantId, snapshot_hash: computeSnapshotHash(fields), expires_at: new Date(Date.now() - 1000).toISOString() });

    const ctx = makeCtx(fake, tenantId);
    const result = await verifySendPreconditions(ctx, { to_address: "x@example.com", subject: "Hi", body: "Body", lead_id: null, approval_request_id: "appr-1" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("APPROVAL_EXPIRED");
  });

  it("fails with DO_NOT_CONTACT when the lead has since been added to the DNC list", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "Acme Inc", domain: "acme.example.com" });
    fake.table("do_not_contact").push({ id: "dnc-1", tenant_id: tenantId, normalized_company_name: "ACMEINC", normalized_domain: "acme.example.com" });

    const ctx = makeCtx(fake, tenantId);
    const result = await verifySendPreconditions(ctx, { to_address: "contact@acme.example.com", subject: "Hi", body: "Body", lead_id: "lead-1", approval_request_id: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("DO_NOT_CONTACT");
  });

  it("passes when the lead is not on the DNC list", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "Acme Inc", domain: "acme.example.com" });

    const ctx = makeCtx(fake, tenantId);
    const result = await verifySendPreconditions(ctx, { to_address: "contact@acme.example.com", subject: "Hi", body: "Body", lead_id: "lead-1", approval_request_id: null });
    expect(result.ok).toBe(true);
  });
});
