import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { loadConnection } from "@/lib/integrations/tokenStore";

/**
 * Read-only status for the ACTING user's own Google connection (never
 * another tenant member's — integration_connections is scoped per-user, and
 * loadConnection() is always called with ctx.userId, never a client-supplied
 * id). Never returns encrypted_access_token/encrypted_refresh_token — only
 * status/scopes/connected_email, none of which are token material.
 */
export async function GET() {
  return withRoute(async () => {
    const ctx = await getTenantContext();
    const connection = await loadConnection(ctx.supabase, ctx.tenantId, ctx.userId, "google");
    return {
      configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
      connection: connection
        ? {
            provider: connection.provider,
            status: connection.status,
            connectedEmail: connection.connected_email,
            scopes: connection.scopes ?? [],
          }
        : null,
    };
  });
}
