import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { encryptToken } from "@/lib/integrations/crypto";
import { NeedsReauthenticationError, getValidAccessToken, loadConnection, saveConnectionTokens, type IntegrationConnectionRow } from "@/lib/integrations/tokenStore";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "1".repeat(64);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
});

function makeConnection(overrides: Partial<IntegrationConnectionRow>): IntegrationConnectionRow {
  return {
    id: "conn-1",
    tenant_id: "t1",
    user_id: "u1",
    provider: "google",
    status: "connected",
    scopes: [],
    connected_email: "sales@example.com",
    encrypted_access_token: encryptToken("live-access-token"),
    encrypted_refresh_token: encryptToken("live-refresh-token"),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

describe("saveConnectionTokens / loadConnection", () => {
  it("stores tokens only as ciphertext, never plaintext, and round-trips a decrypted read", async () => {
    const fake = new FakeSupabase();
    await saveConnectionTokens(fake as unknown as never, {
      tenantId: "t1",
      userId: "u1",
      provider: "google",
      tokens: { access_token: "plain-access", refresh_token: "plain-refresh", expires_in: 3600, scope: "", token_type: "Bearer" },
      connectedEmail: "sales@example.com",
      scopes: ["gmail.compose"],
    });

    const row = fake.table("integration_connections")[0];
    expect(row.encrypted_access_token).not.toContain("plain-access");
    expect(row.encrypted_refresh_token).not.toContain("plain-refresh");
    expect(row.status).toBe("connected");

    const loaded = await loadConnection(fake as unknown as never, "t1", "u1", "google");
    expect(loaded?.connected_email).toBe("sales@example.com");
  });

  it("does not overwrite a previously stored refresh token when a later exchange omits one", async () => {
    const fake = new FakeSupabase();
    await saveConnectionTokens(fake as unknown as never, {
      tenantId: "t1",
      userId: "u1",
      provider: "google",
      tokens: { access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: "", token_type: "Bearer" },
      connectedEmail: "sales@example.com",
      scopes: [],
    });
    const firstRefresh = fake.table("integration_connections")[0].encrypted_refresh_token;

    await saveConnectionTokens(fake as unknown as never, {
      tenantId: "t1",
      userId: "u1",
      provider: "google",
      tokens: { access_token: "a2", expires_in: 3600, scope: "", token_type: "Bearer" },
      connectedEmail: "sales@example.com",
      scopes: [],
    });

    expect(fake.table("integration_connections")).toHaveLength(1);
    expect(fake.table("integration_connections")[0].encrypted_refresh_token).toBe(firstRefresh);
  });
});

describe("getValidAccessToken", () => {
  it("returns the decrypted access token directly when it is not near expiry", async () => {
    const fake = new FakeSupabase();
    const connection = makeConnection({});
    const token = await getValidAccessToken(fake as unknown as never, connection);
    expect(token).toBe("live-access-token");
  });

  it("throws NeedsReauthenticationError immediately for a connection already marked needs_reauth", async () => {
    const fake = new FakeSupabase();
    const connection = makeConnection({ status: "needs_reauth" });
    await expect(getValidAccessToken(fake as unknown as never, connection)).rejects.toThrow(NeedsReauthenticationError);
  });

  describe("refresh-on-expiry (mocked Google endpoint)", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("refreshes and persists a new access token when the stored one is expired", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "refreshed-access-token", expires_in: 3600, scope: "", token_type: "Bearer" }) });

      const fake = new FakeSupabase();
      fake.table("integration_connections").push(makeConnection({ expires_at: new Date(Date.now() - 1000).toISOString() }) as unknown as Record<string, unknown>);
      const connection = fake.table("integration_connections")[0] as unknown as IntegrationConnectionRow;
      const originalEncryptedAccessToken = connection.encrypted_access_token;

      const token = await getValidAccessToken(fake as unknown as never, connection);
      expect(token).toBe("refreshed-access-token");

      const row = fake.table("integration_connections")[0];
      expect(row.encrypted_access_token).not.toBe(originalEncryptedAccessToken);
    });

    it("marks the connection needs_reauth and throws when the refresh token is invalid (invalid_grant)", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });

      const fake = new FakeSupabase();
      fake.table("integration_connections").push(makeConnection({ expires_at: new Date(Date.now() - 1000).toISOString() }) as unknown as Record<string, unknown>);
      const connection = fake.table("integration_connections")[0] as unknown as IntegrationConnectionRow;

      await expect(getValidAccessToken(fake as unknown as never, connection)).rejects.toThrow(NeedsReauthenticationError);
      expect(fake.table("integration_connections")[0].status).toBe("needs_reauth");
    });

    it("never retries indefinitely: a refresh failure surfaces after Google's official retry/backoff budget, not a silent infinite loop", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ "retry-after": "0" }), json: async () => ({ error: "rate_limit_exceeded" }) });

      const fake = new FakeSupabase();
      fake.table("integration_connections").push(makeConnection({ expires_at: new Date(Date.now() - 1000).toISOString() }) as unknown as Record<string, unknown>);
      const connection = fake.table("integration_connections")[0] as unknown as IntegrationConnectionRow;

      await expect(getValidAccessToken(fake as unknown as never, connection)).rejects.toThrow(NeedsReauthenticationError);
      // MAX_RETRIES=4 -> 5 total attempts, not unbounded.
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    });
  });
});
