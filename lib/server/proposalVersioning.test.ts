import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { createNewProposalVersion } from "@/lib/server/proposalVersioning";
import type { TenantContext } from "@/lib/server/tenant";

function makeCtx(fake: FakeSupabase, tenantId: string): TenantContext {
  return { supabase: fake as unknown as TenantContext["supabase"], tenantId, userId: "user-1", userEmail: null, role: "owner" };
}

describe("createNewProposalVersion", () => {
  it("creates a new row with version+1, previous_version_id set, and status reset to DRAFT", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("proposals").push({
      id: "prop-1",
      tenant_id: tenantId,
      opportunity_id: "opp-1",
      version: 1,
      status: "APPROVED",
      title: "旧タイトル",
      scope: ["SEO"],
      content_json: { title: "旧タイトル", scope: ["SEO"], executiveSummary: "summary" },
    });

    const ctx = makeCtx(fake, tenantId);
    const newId = await createNewProposalVersion(ctx, "prop-1", { changeSummary: "スコープにAIOを追加", contentPatch: { scope: ["SEO", "AIO"] } });

    const rows = fake.table("proposals");
    expect(rows).toHaveLength(2);
    const newRow = rows.find((r) => r.id === newId)!;
    expect(newRow.version).toBe(2);
    expect(newRow.previous_version_id).toBe("prop-1");
    expect(newRow.status).toBe("DRAFT");
    expect(newRow.change_summary).toBe("スコープにAIOを追加");
    expect(newRow.scope).toEqual(["SEO", "AIO"]);
    // Unpatched fields carry over from the old content_json.
    expect((newRow.content_json as Record<string, unknown>).title).toBe("旧タイトル");
    expect(newRow.title).toBe("旧タイトル");
  });

  it("never mutates the original row", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("proposals").push({ id: "prop-1", tenant_id: tenantId, opportunity_id: "opp-1", version: 1, status: "SENT", title: "x", content_json: { title: "x" } });

    const ctx = makeCtx(fake, tenantId);
    await createNewProposalVersion(ctx, "prop-1", { changeSummary: "reason" });

    const original = fake.table("proposals").find((r) => r.id === "prop-1")!;
    expect(original.status).toBe("SENT");
    expect(original.title).toBe("x");
  });

  it("requires a non-empty changeSummary", async () => {
    const fake = new FakeSupabase();
    fake.table("proposals").push({ id: "prop-1", tenant_id: "t1", version: 1, content_json: {} });
    const ctx = makeCtx(fake, "t1");
    await expect(createNewProposalVersion(ctx, "prop-1", { changeSummary: "" })).rejects.toThrow(/changeSummary/);
  });

  it("throws NotFoundError for a proposal in a different tenant", async () => {
    const fake = new FakeSupabase();
    fake.table("proposals").push({ id: "prop-1", tenant_id: "other-tenant", version: 1, content_json: {} });
    const ctx = makeCtx(fake, "t1");
    await expect(createNewProposalVersion(ctx, "prop-1", { changeSummary: "x" })).rejects.toThrow();
  });
});
