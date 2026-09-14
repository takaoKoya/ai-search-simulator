import type { SupabaseServerClient } from "@/lib/server/tenant";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";
import { GoogleOAuthError, refreshAccessToken, type GoogleTokenResponse } from "@/lib/integrations/oauth";

/**
 * Reads/writes `integration_connections` (spec §7): the only place tokens
 * are ever encrypted, decrypted, or auto-refreshed. Nothing outside this
 * module should touch `encrypted_access_token`/`encrypted_refresh_token`
 * directly, and nothing here ever logs a decrypted token.
 */

export interface IntegrationConnectionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  status: string;
  scopes: string[] | null;
  connected_email: string | null;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
}

const CONNECTION_COLUMNS = "id, tenant_id, user_id, provider, status, scopes, connected_email, encrypted_access_token, encrypted_refresh_token, expires_at";

export async function loadConnection(supabase: SupabaseServerClient, tenantId: string, userId: string, provider: string): Promise<IntegrationConnectionRow | null> {
  const { data, error } = await supabase.from("integration_connections").select(CONNECTION_COLUMNS).eq("tenant_id", tenantId).eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (error) throw error;
  return data as IntegrationConnectionRow | null;
}

/**
 * Persists tokens from a fresh OAuth exchange. Never logs `tokens` — the
 * caller (the OAuth callback route) must not log it either.
 */
export async function saveConnectionTokens(
  supabase: SupabaseServerClient,
  params: { tenantId: string; userId: string; provider: string; tokens: GoogleTokenResponse; connectedEmail: string | null; scopes: string[] }
): Promise<void> {
  const update: Record<string, unknown> = {
    status: "connected",
    scopes: params.scopes,
    connected_email: params.connectedEmail,
    encrypted_access_token: encryptToken(params.tokens.access_token),
    expires_at: new Date(Date.now() + params.tokens.expires_in * 1000).toISOString(),
    connected_at: new Date().toISOString(),
    revoked_at: null,
  };
  // The refresh_token is only returned on the FIRST consent grant (with
  // access_type=offline + prompt=consent); a later token exchange might not
  // include one, so never overwrite a previously stored refresh token with
  // null — only set it when Google actually issued a new one.
  if (params.tokens.refresh_token) {
    update.encrypted_refresh_token = encryptToken(params.tokens.refresh_token);
  }

  const existing = await loadConnection(supabase, params.tenantId, params.userId, params.provider);
  if (existing) {
    const { error } = await supabase.from("integration_connections").update(update).eq("id", existing.id).eq("tenant_id", params.tenantId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("integration_connections").insert({ tenant_id: params.tenantId, user_id: params.userId, provider: params.provider, ...update });
    if (error) throw error;
  }
}

export class NeedsReauthenticationError extends Error {}

const EXPIRY_SKEW_MS = 60 * 1000; // refresh 1 minute before actual expiry

/**
 * Returns a live, decrypted Gmail/Calendar access token for this
 * connection, transparently refreshing it first if it is expired or about
 * to expire. On a refresh failure (revoked/expired refresh token), marks the
 * connection `needs_reauth` and throws NeedsReauthenticationError — callers
 * (GoogleGmailConnector/GoogleCalendarConnector) must surface this as "please
 * reconnect Google" and never retry silently forever (spec §9).
 */
export async function getValidAccessToken(supabase: SupabaseServerClient, connection: IntegrationConnectionRow): Promise<string> {
  if (connection.status === "needs_reauth" || connection.status === "revoked" || connection.status === "disabled" || connection.status === "permission_error") {
    throw new NeedsReauthenticationError(`Google connection is ${connection.status}`);
  }
  if (!connection.encrypted_access_token || !connection.expires_at) {
    await markNeedsReauth(supabase, connection.id);
    throw new NeedsReauthenticationError("Google connection has no stored access token");
  }

  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return decryptToken(connection.encrypted_access_token);
  }

  if (!connection.encrypted_refresh_token) {
    await markNeedsReauth(supabase, connection.id);
    throw new NeedsReauthenticationError("Access token expired and no refresh token is stored");
  }

  try {
    const refreshToken = decryptToken(connection.encrypted_refresh_token);
    const tokens = await refreshAccessToken(refreshToken);
    await supabase
      .from("integration_connections")
      .update({
        encrypted_access_token: encryptToken(tokens.access_token),
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", connection.id)
      .eq("tenant_id", connection.tenant_id);
    return tokens.access_token;
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      await markNeedsReauth(supabase, connection.id);
      throw new NeedsReauthenticationError(`Google refresh failed: ${err.code}`);
    }
    throw err;
  }
}

async function markNeedsReauth(supabase: SupabaseServerClient, connectionId: string): Promise<void> {
  await supabase.from("integration_connections").update({ status: "needs_reauth" }).eq("id", connectionId);
}
