import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { checkDuplicate } from "@/lib/sales/duplicates";
import { normalizeCompanyName, normalizeDomain } from "@/lib/sales/normalize";
import type { SupabaseServerClient } from "@/lib/server/tenant";

const tenantId = "tenant-dup";

function client(fake: FakeSupabase): SupabaseServerClient {
  return fake as unknown as SupabaseServerClient;
}

describe("checkDuplicate", () => {
  it("returns NEW when nothing matches", async () => {
    const fake = new FakeSupabase();
    const result = await checkDuplicate(client(fake), tenantId, {
      normalizedDomain: normalizeDomain("https://new-company.example.jp"),
      normalizedCompanyName: normalizeCompanyName("新規株式会社"),
    });
    expect(result.status).toBe("NEW");
  });

  it("returns BLOCKED when the domain is on the Do Not Contact list", async () => {
    const fake = new FakeSupabase();
    const normalizedDomain = normalizeDomain("https://blocked.example.jp")!;
    fake.table("do_not_contact").push({ tenant_id: tenantId, normalized_domain: normalizedDomain, reason: "過去にクレームあり" });

    const result = await checkDuplicate(client(fake), tenantId, { normalizedDomain, normalizedCompanyName: null });
    expect(result.status).toBe("BLOCKED");
    expect(result.reason).toContain("過去にクレームあり");
  });

  it("returns BLOCKED when the company name (no domain) is on the Do Not Contact list", async () => {
    const fake = new FakeSupabase();
    const normalizedCompanyName = normalizeCompanyName("株式会社ブロック");
    fake.table("do_not_contact").push({ tenant_id: tenantId, normalized_company_name: normalizedCompanyName, reason: "DNC登録済み" });

    const result = await checkDuplicate(client(fake), tenantId, { normalizedDomain: null, normalizedCompanyName });
    expect(result.status).toBe("BLOCKED");
  });

  it("returns EXISTING_CLIENT when the normalized name matches an existing client", async () => {
    const fake = new FakeSupabase();
    fake.table("clients").push({ tenant_id: tenantId, name: "株式会社クライアント" });

    const result = await checkDuplicate(client(fake), tenantId, {
      normalizedDomain: null,
      normalizedCompanyName: normalizeCompanyName("クライアント株式会社"),
    });
    expect(result.status).toBe("EXISTING_CLIENT");
  });

  it("returns EXISTING_LEAD for a same-domain lead still active in the pipeline", async () => {
    const fake = new FakeSupabase();
    const normalizedDomain = normalizeDomain("https://active-lead.example.jp")!;
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, normalized_domain: normalizedDomain, status: "researching", discovery_stage: "RESEARCHING" });

    const result = await checkDuplicate(client(fake), tenantId, { normalizedDomain, normalizedCompanyName: null });
    expect(result.status).toBe("EXISTING_LEAD");
    expect(result.matchedLeadId).toBe("lead-1");
  });

  it("returns PREVIOUSLY_CONTACTED for a same-domain lead that was already closed out", async () => {
    const fake = new FakeSupabase();
    const normalizedDomain = normalizeDomain("https://closed-lead.example.jp")!;
    fake.table("leads").push({ id: "lead-2", tenant_id: tenantId, normalized_domain: normalizedDomain, status: "lost", discovery_stage: "LOST" });

    const result = await checkDuplicate(client(fake), tenantId, { normalizedDomain, normalizedCompanyName: null });
    expect(result.status).toBe("PREVIOUSLY_CONTACTED");
    expect(result.matchedLeadId).toBe("lead-2");
  });

  it("returns POSSIBLE_DUPLICATE for a name match without a domain match, for a human to confirm", async () => {
    const fake = new FakeSupabase();
    const normalizedCompanyName = normalizeCompanyName("株式会社サンプル");
    fake.table("leads").push({ id: "lead-3", tenant_id: tenantId, normalized_domain: "other-domain.example.jp", normalized_company_name: normalizedCompanyName, status: "new" });

    const result = await checkDuplicate(client(fake), tenantId, {
      normalizedDomain: normalizeDomain("https://different-domain.example.jp"),
      normalizedCompanyName,
    });
    expect(result.status).toBe("POSSIBLE_DUPLICATE");
    expect(result.matchedLeadId).toBe("lead-3");
  });

  it("does not treat a candidate's own just-inserted lead row as a duplicate of itself", async () => {
    // lead_discovery_graph inserts the candidate's own lead row before running
    // this check (so an audit trail exists even for excluded candidates) —
    // excludeLeadId must keep that self-row from matching itself.
    const fake = new FakeSupabase();
    const normalizedDomain = normalizeDomain("https://self.example.jp")!;
    const normalizedCompanyName = normalizeCompanyName("株式会社セルフ");
    fake.table("leads").push({ id: "self-lead", tenant_id: tenantId, normalized_domain: normalizedDomain, normalized_company_name: normalizedCompanyName, status: "new" });

    const result = await checkDuplicate(client(fake), tenantId, { normalizedDomain, normalizedCompanyName, excludeLeadId: "self-lead" });
    expect(result.status).toBe("NEW");
  });

  it("never leaks matches across tenants", async () => {
    const fake = new FakeSupabase();
    const normalizedDomain = normalizeDomain("https://other-tenant.example.jp")!;
    fake.table("leads").push({ id: "lead-4", tenant_id: "some-other-tenant", normalized_domain: normalizedDomain, status: "new" });

    const result = await checkDuplicate(client(fake), tenantId, { normalizedDomain, normalizedCompanyName: null });
    expect(result.status).toBe("NEW");
  });
});
