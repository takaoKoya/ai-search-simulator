import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { createNewEstimateVersion } from "@/lib/server/estimateVersioning";
import type { TenantContext } from "@/lib/server/tenant";

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "user-1", userEmail: null, role: "owner" };
}

describe("createNewEstimateVersion", () => {
  it("creates a new row with version+1, previous_version_id set, and status reset to DRAFT", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("estimates").push({
      id: "est-1",
      tenant_id: tenantId,
      proposal_id: "prop-1",
      opportunity_id: "opp-1",
      version: 1,
      status: "APPROVED",
      total: 300000,
      payment_terms: "月末締め翌月末払い",
      content_json: { total: 300000, lineItems: [{ catalogCode: "SEO", service: "SEO Standard", quantity: 1, unitPrice: 248000, discount: 0, amount: 248000 }] },
    });

    const ctx = makeCtx(fake, tenantId);
    const newId = await createNewEstimateVersion(ctx, "est-1", { changeSummary: "値引き追加", contentPatch: { total: 280000 } });

    const rows = fake.table("estimates");
    expect(rows).toHaveLength(2);
    const newRow = rows.find((r) => r.id === newId)!;
    expect(newRow.version).toBe(2);
    expect(newRow.previous_version_id).toBe("est-1");
    expect(newRow.status).toBe("DRAFT");
    expect(newRow.proposal_id).toBe("prop-1");
    expect(newRow.total).toBe(280000);
    expect(newRow.payment_terms).toBe("月末締め翌月末払い");
  });

  it("never mutates the original row", async () => {
    const fake = new FakeSupabase();
    fake.table("estimates").push({ id: "est-1", tenant_id: "t1", proposal_id: "prop-1", version: 1, status: "SENT", total: 300000, content_json: { total: 300000 } });
    const ctx = makeCtx(fake, "t1");
    await createNewEstimateVersion(ctx, "est-1", { changeSummary: "x" });
    const original = fake.table("estimates").find((r) => r.id === "est-1")!;
    expect(original.status).toBe("SENT");
    expect(original.total).toBe(300000);
  });

  it("requires a non-empty changeSummary", async () => {
    const fake = new FakeSupabase();
    fake.table("estimates").push({ id: "est-1", tenant_id: "t1", version: 1, content_json: {} });
    const ctx = makeCtx(fake, "t1");
    await expect(createNewEstimateVersion(ctx, "est-1", { changeSummary: "  " })).rejects.toThrow(/changeSummary/);
  });
});
