import crypto from "crypto";
import type { SupabaseServerClient } from "@/lib/server/tenant";
import { fetchWithRetry } from "@/lib/integrations/httpRetry";

/**
 * Google OAuth 2.0 Authorization Code Flow + PKCE (spec §5-9).
 *
 * Explicitly prohibited by the product brief, and never done anywhere in
 * this module: storing the user's Google password, cookie theft, browser
 * session reuse, unofficial/private APIs, auto-login, or scraping-based
 * Gmail operation. Every token this module produces comes from Google's
 * official `/o/oauth2/v2/auth` and `/token` endpoints only.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Minimum-necessary scopes (spec §8) — deliberately excludes
 * `https://mail.google.com/` (full mailbox incl. permanent delete),
 * `gmail.settings.*`, and any Contacts scope.
 *
 * - `gmail.compose`: create/send/delete only the tenant's OWN drafts —
 *   covers createDraft()/sendDraft() without granting arbitrary mailbox
 *   write access.
 * - `gmail.readonly`: Gmail has no thread-scoped OAuth scope, so reading a
 *   specific reply thread requires this broader read scope at the OAuth
 *   layer. The narrowing to "only this sales thread" happens in application
 *   code (GoogleGmailConnector): every read is keyed by
 *   provider_thread_id/provider_message_id for one specific sales_message,
 *   never a mailbox-wide search — see README Known Limitations for why a
 *   narrower official scope does not exist.
 * - `calendar.events`: create/read/update/delete events only — excludes
 *   calendar settings and calendar list management.
 */
export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

export function generateCodeChallenge(codeVerifier: string): string {
  return base64url(crypto.createHash("sha256").update(codeVerifier).digest());
}

export function generateState(): string {
  return base64url(crypto.randomBytes(32));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function buildGoogleAuthUrl(params: { clientId: string; redirectUri: string; scopes: string[]; state: string; codeChallenge: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ------------------------------------------------------------------
// Server-side OAuth state (CSRF defense, spec §6)
// ------------------------------------------------------------------

export interface OAuthStateRow {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  state: string;
  code_verifier: string;
  scopes: string[];
  redirect_uri: string;
  expires_at: string;
  consumed_at: string | null;
}

export class OAuthStateError extends Error {}

/**
 * Starts an OAuth flow: generates PKCE verifier/challenge + a single-use
 * state, persists them server-side (never in a cookie or client-supplied
 * value), and returns the Google consent URL to redirect the user to.
 */
export async function createOAuthState(
  supabase: SupabaseServerClient,
  params: { tenantId: string; userId: string; provider: string; scopes: string[]; redirectUri: string }
): Promise<{ state: string; authUrl: string }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const { error } = await supabase.from("oauth_states").insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    provider: params.provider,
    state,
    code_verifier: codeVerifier,
    scopes: params.scopes,
    redirect_uri: params.redirectUri,
    expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
  });
  if (error) throw error;

  const authUrl = buildGoogleAuthUrl({
    clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    state,
    codeChallenge,
  });
  return { state, authUrl };
}

/**
 * Verifies+consumes a single-use OAuth state (spec §6): checked against this
 * server-side row — never trusted from the callback request's `state`
 * parameter alone — scoped to the same tenant+user+provider that started
 * the flow, not expired, not already consumed. Marking `consumed_at` here
 * makes a replayed callback fail even if an attacker captured a valid
 * state+code pair (the code itself is also single-use at Google's end).
 */
export async function consumeOAuthState(
  supabase: SupabaseServerClient,
  params: { state: string; tenantId: string; userId: string; provider: string }
): Promise<OAuthStateRow> {
  const { data: row, error } = await supabase
    .from("oauth_states")
    .select("id, tenant_id, user_id, provider, state, code_verifier, scopes, redirect_uri, expires_at, consumed_at")
    .eq("state", params.state)
    .eq("tenant_id", params.tenantId)
    .eq("user_id", params.userId)
    .eq("provider", params.provider)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new OAuthStateError("Unknown or mismatched OAuth state");
  if (row.consumed_at) throw new OAuthStateError("OAuth state already used");
  if (new Date(row.expires_at as string).getTime() < Date.now()) throw new OAuthStateError("OAuth state expired");

  const { error: updateError } = await supabase.from("oauth_states").update({ consumed_at: new Date().toISOString() }).eq("id", row.id as string);
  if (updateError) throw updateError;

  return row as unknown as OAuthStateRow;
}

// ------------------------------------------------------------------
// Token exchange / refresh
// ------------------------------------------------------------------

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export class GoogleOAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(`Google OAuth token request failed: ${status} ${code}`);
  }
}

/**
 * Never logs the response body — it can carry token-adjacent detail. Only
 * the HTTP status and Google's short `error` code (e.g. "invalid_grant")
 * are ever surfaced, never token material.
 */
async function postToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const res = await fetchWithRetry(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const errJson: unknown = await res.json().catch(() => ({}));
    const code = typeof errJson === "object" && errJson && "error" in errJson && typeof (errJson as { error: unknown }).error === "string" ? (errJson as { error: string }).error : "token_request_failed";
    throw new GoogleOAuthError(res.status, code);
  }
  return res.json();
}

export async function exchangeCodeForTokens(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    code_verifier: params.codeVerifier,
  });
  return postToken(body);
}

/**
 * Refresh-token failure (invalid_grant — revoked/expired) must transition
 * the connection to NEEDS_REAUTHENTICATION rather than retrying forever
 * (spec §9). This function itself never retries on a 4xx error, only on
 * 429/5xx via fetchWithRetry; the NEEDS_REAUTHENTICATION transition itself
 * happens one layer up, in lib/integrations/tokenStore.ts, which is the
 * only caller that should ever invoke this.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
  });
  return postToken(body);
}
