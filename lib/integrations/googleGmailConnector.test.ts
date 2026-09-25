import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/lib/integrations/crypto";
import { GoogleGmailConnector } from "@/lib/integrations/googleGmailConnector";
import type { IntegrationConnectionRow } from "@/lib/integrations/tokenStore";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "2".repeat(64);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
});

function makeConnection(): IntegrationConnectionRow {
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
  };
}

describe("GoogleGmailConnector", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createDraft POSTs a base64url raw MIME message to Gmail's official drafts endpoint with a bearer token", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "draft-123" }) });

    const connector = new GoogleGmailConnector({} as never, makeConnection());
    const result = await connector.createDraft({ to: "prospect@example.com", subject: "ご提案", body: "本文です。" });
    expect(result).toEqual({ provider: "google_gmail", providerDraftId: "draft-123" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer live-access-token");

    const body = JSON.parse(init.body as string);
    const decodedMessage = Buffer.from(body.message.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decodedMessage).toContain("To: prospect@example.com");
    expect(decodedMessage).toContain("本文です。");
    // A Japanese subject must be RFC 2047-encoded, never sent as raw UTF-8.
    expect(decodedMessage).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("send() posts to messages.send, not drafts.send", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "msg-1", threadId: "thread-1" }) });

    const connector = new GoogleGmailConnector({} as never, makeConnection());
    const result = await connector.send({ to: "prospect@example.com", subject: "Hello", body: "Hi there" }, "idem-1");
    expect(result.provider).toBe("google_gmail");
    expect(result.providerMessageId).toBe("msg-1");
    expect(result.providerThreadId).toBe("thread-1");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  });

  it("throws when Gmail returns a non-ok response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });

    const connector = new GoogleGmailConnector({} as never, makeConnection());
    await expect(connector.createDraft({ to: "x@example.com", subject: "x", body: "x" })).rejects.toThrow();
  });
});
