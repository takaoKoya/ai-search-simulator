import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import {
  GOOGLE_OAUTH_SCOPES,
  GoogleOAuthError,
  OAuthStateError,
  buildGoogleAuthUrl,
  consumeOAuthState,
  createOAuthState,
  exchangeCodeForTokens,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  refreshAccessToken,
} from "@/lib/integrations/oauth";

beforeAll(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
});

describe("scope minimality (spec §8)", () => {
  it("never requests full-mailbox, settings, or Contacts scopes", () => {
    for (const scope of GOOGLE_OAUTH_SCOPES) {
      expect(scope).not.toBe("https://mail.google.com/");
      expect(scope).not.toMatch(/gmail\.settings/);
      expect(scope).not.toMatch(/contacts/);
    }
  });
});

describe("PKCE", () => {
  it("generates a deterministic S256 challenge from a verifier", () => {
    const verifier = generateCodeVerifier();
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
  });

  it("generates distinct verifiers/states on each call", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
    expect(generateState()).not.toBe(generateState());
  });

  it("never emits standard-base64 characters ('+', '/', '=') in verifier/state/challenge", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateState();
    for (const value of [verifier, challenge, state]) {
      expect(value).not.toMatch(/[+/=]/);
    }
  });
});

describe("buildGoogleAuthUrl", () => {
  it("targets Google's official authorization endpoint with PKCE + state params", () => {
    const url = new URL(
      buildGoogleAuthUrl({
        clientId: "cid",
        redirectUri: "https://app.example.com/callback",
        scopes: GOOGLE_OAUTH_SCOPES,
        state: "the-state",
        codeChallenge: "the-challenge",
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_OAUTH_SCOPES.join(" "));
  });
});

describe("createOAuthState / consumeOAuthState (CSRF defense, spec §6)", () => {
  it("round-trips: created state can be consumed exactly once by the same tenant/user/provider", async () => {
    const fake = new FakeSupabase();
    const { state, authUrl } = await createOAuthState(fake as unknown as never, {
      tenantId: "t1",
      userId: "u1",
      provider: "google",
      scopes: GOOGLE_OAUTH_SCOPES,
      redirectUri: "https://app.example.com/callback",
    });
    expect(authUrl).toContain("accounts.google.com");
    expect(authUrl).toContain(`state=${state}`);

    const consumed = await consumeOAuthState(fake as unknown as never, { state, tenantId: "t1", userId: "u1", provider: "google" });
    expect(consumed.redirect_uri).toBe("https://app.example.com/callback");

    await expect(consumeOAuthState(fake as unknown as never, { state, tenantId: "t1", userId: "u1", provider: "google" })).rejects.toThrow(OAuthStateError);
  });

  it("rejects a state consumed under a different tenant or user (never trusts the client-supplied state alone)", async () => {
    const fake = new FakeSupabase();
    const { state } = await createOAuthState(fake as unknown as never, {
      tenantId: "t1",
      userId: "u1",
      provider: "google",
      scopes: GOOGLE_OAUTH_SCOPES,
      redirectUri: "https://app.example.com/callback",
    });

    await expect(consumeOAuthState(fake as unknown as never, { state, tenantId: "t2", userId: "u1", provider: "google" })).rejects.toThrow(OAuthStateError);
    await expect(consumeOAuthState(fake as unknown as never, { state, tenantId: "t1", userId: "u2", provider: "google" })).rejects.toThrow(OAuthStateError);
  });

  it("rejects an expired state", async () => {
    const fake = new FakeSupabase();
    fake.table("oauth_states").push({
      id: "state-1",
      tenant_id: "t1",
      user_id: "u1",
      provider: "google",
      state: "expired-state",
      code_verifier: "verifier",
      scopes: GOOGLE_OAUTH_SCOPES,
      redirect_uri: "https://app.example.com/callback",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      consumed_at: null,
    });

    await expect(consumeOAuthState(fake as unknown as never, { state: "expired-state", tenantId: "t1", userId: "u1", provider: "google" })).rejects.toThrow(OAuthStateError);
  });

  it("rejects an unknown state", async () => {
    const fake = new FakeSupabase();
    await expect(consumeOAuthState(fake as unknown as never, { state: "nonexistent", tenantId: "t1", userId: "u1", provider: "google" })).rejects.toThrow(OAuthStateError);
  });
});

describe("token exchange / refresh (mocked Google endpoint — no real network)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges an authorization code for tokens via Google's official /token endpoint", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_OAUTH_SCOPES.join(" "), token_type: "Bearer" }),
    });

    const tokens = await exchangeCodeForTokens({ code: "auth-code", codeVerifier: "verifier", redirectUri: "https://app.example.com/callback" });
    expect(tokens.access_token).toBe("at");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier");
  });

  it("throws GoogleOAuthError (never retries) on a non-429/5xx failure like invalid_grant", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });

    await expect(refreshAccessToken("bad-refresh-token")).rejects.toThrow(GoogleOAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 with backoff before succeeding", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "retry-after": "0" }), json: async () => ({ error: "rate_limit_exceeded" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "at2", expires_in: 3600, scope: "", token_type: "Bearer" }) });

    const tokens = await refreshAccessToken("some-refresh-token");
    expect(tokens.access_token).toBe("at2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
