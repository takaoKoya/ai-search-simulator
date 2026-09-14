import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { createDeliveryPackage, sendDeliveryPackage } from "@/lib/server/deliveryPackage";
import type { TenantContext } from "@/lib/server/tenant";

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "user-1", userEmail: null, role: "owner" };
}

describe("createDeliveryPackage", () => {
  it("refuses to package a proposal that is not yet approved", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, status: "DRAFT", opportunity_id: "opp-1" });

    const ctx = makeCtx(fake, tenantId);
    await expect(createDeliveryPackage(ctx, { opportunityId: "opp-1", proposalId: "prop-1" })).rejects.toThrow(/approved/);
  });

  it("refuses to package a proposal with no CLIENT_VISIBLE file generated yet", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, status: "APPROVED", opportunity_id: "opp-1" });
    fake.table("estimates").push({ id: "est-1", tenant_id: tenantId, proposal_id: "prop-1" });
    fake.table("generated_files").push({ id: "file-1", tenant_id: tenantId, entity_type: "proposal", entity_id: "prop-1", classification: "INTERNAL" });

    const ctx = makeCtx(fake, tenantId);
    await expect(createDeliveryPackage(ctx, { opportunityId: "opp-1", proposalId: "prop-1" })).rejects.toThrow(/CLIENT_VISIBLE/);
  });

  it("creates a package attaching only CLIENT_VISIBLE files", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, status: "APPROVED", opportunity_id: "opp-1" });
    fake.table("estimates").push({ id: "est-1", tenant_id: tenantId, proposal_id: "prop-1" });
    fake.table("generated_files").push(
      { id: "file-internal", tenant_id: tenantId, entity_type: "proposal", entity_id: "prop-1", classification: "INTERNAL" },
      { id: "file-visible", tenant_id: tenantId, entity_type: "proposal", entity_id: "prop-1", classification: "CLIENT_VISIBLE" }
    );

    const ctx = makeCtx(fake, tenantId);
    const packageId = await createDeliveryPackage(ctx, { opportunityId: "opp-1", proposalId: "prop-1", coverMessage: "ご確認ください" });

    const pkg = fake.table("delivery_packages").find((p) => p.id === packageId)!;
    expect(pkg.status).toBe("DRAFT");
    expect(pkg.attachment_file_ids).toEqual(["file-visible"]);
    expect(pkg.estimate_id).toBe("est-1");
    expect(pkg.cover_message).toBe("ご確認ください");
  });
});

describe("sendDeliveryPackage", () => {
  it("marks the package SENT when all attached files are still CLIENT_VISIBLE", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("generated_files").push({ id: "file-1", tenant_id: tenantId, classification: "CLIENT_VISIBLE" });
    fake.table("delivery_packages").push({ id: "pkg-1", tenant_id: tenantId, status: "DRAFT", attachment_file_ids: ["file-1"] });

    const ctx = makeCtx(fake, tenantId);
    await sendDeliveryPackage(ctx, "pkg-1");

    const pkg = fake.table("delivery_packages").find((p) => p.id === "pkg-1")!;
    expect(pkg.status).toBe("SENT");
    expect(pkg.sent_at).toBeTruthy();
  });

  it("refuses to send when an attached file is no longer CLIENT_VISIBLE", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("generated_files").push({ id: "file-1", tenant_id: tenantId, classification: "INTERNAL" });
    fake.table("delivery_packages").push({ id: "pkg-1", tenant_id: tenantId, status: "DRAFT", attachment_file_ids: ["file-1"] });

    const ctx = makeCtx(fake, tenantId);
    await expect(sendDeliveryPackage(ctx, "pkg-1")).rejects.toThrow(/CLIENT_VISIBLE/);
  });

  it("is idempotent: sending an already-SENT package is a silent no-op", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("delivery_packages").push({ id: "pkg-1", tenant_id: tenantId, status: "SENT", attachment_file_ids: [] });
    const ctx = makeCtx(fake, tenantId);
    await expect(sendDeliveryPackage(ctx, "pkg-1")).resolves.toBeUndefined();
  });
});
