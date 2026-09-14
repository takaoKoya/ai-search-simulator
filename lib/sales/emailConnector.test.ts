import { afterEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { getEmailConnector, SimulatedEmailConnector } from "@/lib/sales/emailConnector";

describe("SimulatedEmailConnector", () => {
  it("never claims to be a real connector", () => {
    const connector = new SimulatedEmailConnector();
    expect(connector.isReal).toBe(false);
  });

  it("createDraft is deterministic and does not send", async () => {
    const connector = new SimulatedEmailConnector();
    const draft = { to: "test@example.com", subject: "Hello", body: "Body" };
    const a = await connector.createDraft(draft);
    const b = await connector.createDraft(draft);
    expect(a.providerDraftId).toBe(b.providerDraftId);
    expect(a.provider).toBe("simulated_gmail");
  });

  it("send() produces a distinct provider message id per idempotency key", async () => {
    const connector = new SimulatedEmailConnector();
    const draft = { to: "test@example.com", subject: "Hello", body: "Body" };
    const first = await connector.send(draft, "key-1");
    const second = await connector.send(draft, "key-2");
    expect(first.providerMessageId).not.toBe(second.providerMessageId);
  });

  it("send() is deterministic for the same idempotency key (safe to retry the call itself)", async () => {
    const connector = new SimulatedEmailConnector();
    const draft = { to: "test@example.com", subject: "Hello", body: "Body" };
    const a = await connector.send(draft, "same-key");
    const b = await connector.send(draft, "same-key");
    expect(a.providerMessageId).toBe(b.providerMessageId);
  });
});

describe("getEmailConnector (real-vs-simulated fallback)", () => {
  const originalClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  afterEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = originalClientId;
  });

  it("returns the Simulated connector when no ctx is given", async () => {
    const connector = await getEmailConnector();
    expect(connector.isReal).toBe(false);
  });

  it("returns the Simulated connector when Google OAuth is not configured, even with a ctx", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const fake = new FakeSupabase();
    const connector = await getEmailConnector({ supabase: fake as unknown as never, tenantId: "t1", userId: "u1" });
    expect(connector.isReal).toBe(false);
  });

  it("returns the Simulated connector when the tenant/user has no connected google integration", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "configured";
    const fake = new FakeSupabase();
    const connector = await getEmailConnector({ supabase: fake as unknown as never, tenantId: "t1", userId: "u1" });
    expect(connector.isReal).toBe(false);
  });

  it("returns the Simulated connector when a connection row exists but is not status=connected", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "configured";
    const fake = new FakeSupabase();
    fake.table("integration_connections").push({ id: "c1", tenant_id: "t1", user_id: "u1", provider: "google", status: "needs_reauth" });
    const connector = await getEmailConnector({ supabase: fake as unknown as never, tenantId: "t1", userId: "u1" });
    expect(connector.isReal).toBe(false);
  });

  it("returns the real GoogleGmailConnector when configured and connected", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "configured";
    const fake = new FakeSupabase();
    fake.table("integration_connections").push({ id: "c1", tenant_id: "t1", user_id: "u1", provider: "google", status: "connected" });
    const connector = await getEmailConnector({ supabase: fake as unknown as never, tenantId: "t1", userId: "u1" });
    expect(connector.isReal).toBe(true);
    expect(connector.provider).toBe("google_gmail");
  });
});
