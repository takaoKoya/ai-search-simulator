import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";
import { loadConnection } from "@/lib/integrations/tokenStore";
import { fetchWithRetry } from "@/lib/integrations/httpRetry";
import { decryptToken } from "@/lib/integrations/crypto";

const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * Disconnects the ACTING user's own Google connection. Best-effort revokes
 * the token at Google (so the grant disappears from the user's Google
 * Account permissions page too), then always clears our own stored
 * ciphertext regardless of whether the revoke call succeeded — a revoke
 * failure must never leave a connection that looks "connected" but can't
 * actually be used.
 */
export async function POST() {
  return withRoute(async () => {
    const ctx = await getTenantContext();
    const connection = await loadConnection(ctx.supabase, ctx.tenantId, ctx.userId, "google");
    if (!connection) throw new NotFoundError("No Google connection to disconnect");

    if (connection.encrypted_access_token) {
      try {
        const accessToken = decryptToken(connection.encrypted_access_token);
        // Token goes in the POST body, not the URL — kept out of anything
        // that might log a request URL.
        await fetchWithRetry(REVOKE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: accessToken }),
        });
      } catch (err) {
        console.error("Google token revoke failed (continuing to clear local connection)", err instanceof Error ? err.message : err);
      }
    }

    await ctx.supabase
      .from("integration_connections")
      .update({
        status: "not_connected",
        encrypted_access_token: null,
        encrypted_refresh_token: null,
        expires_at: null,
        revoked_at: new Date().toISOString(),
      })
      .eq("id", connection.id)
      .eq("tenant_id", ctx.tenantId);

    await ctx.supabase.from("agent_events").insert({
      tenant_id: ctx.tenantId,
      event_type: "integration.google_disconnected",
      message: "Googleアカウントの連携を解除しました",
      payload: { provider: "google" },
    });

    return { disconnected: true };
  });
}
