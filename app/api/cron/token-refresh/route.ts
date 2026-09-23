import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isCronRequestAuthorized } from "@/lib/server/cronAuth";
import { runBackgroundJob } from "@/lib/server/backgroundJob";
import { getValidAccessToken, type IntegrationConnectionRow } from "@/lib/integrations/tokenStore";

const REFRESH_WINDOW_MINUTES = 10;

/**
 * Proactively refreshes Google access tokens nearing expiry (spec §9)
 * across ALL tenants, so a real request never blocks on a refresh
 * round-trip. getValidAccessToken() itself already does this lazily on
 * demand — this job just does it ahead of time, and on a genuine failure
 * (invalid_grant), the connection is marked needs_reauth exactly the same
 * way, never retried forever.
 */
export async function POST(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const result = await runBackgroundJob(supabase, "token-refresh", async () => {
    const soonThreshold = new Date(Date.now() + REFRESH_WINDOW_MINUTES * 60_000).toISOString();
    const { data: connections, error } = await supabase
      .from("integration_connections")
      .select("id, tenant_id, user_id, provider, status, scopes, connected_email, encrypted_access_token, encrypted_refresh_token, expires_at")
      .eq("status", "connected")
      .lt("expires_at", soonThreshold);
    if (error) throw error;

    let refreshed = 0;
    let needsReauth = 0;
    for (const connection of (connections ?? []) as IntegrationConnectionRow[]) {
      try {
        await getValidAccessToken(supabase, connection);
        refreshed += 1;
      } catch {
        needsReauth += 1;
      }
    }
    return { checked: (connections ?? []).length, refreshed, needsReauth };
  });

  return NextResponse.json(result, { status: result.ran ? 200 : 202 });
}

// Vercel Cron Jobs invoke via GET (with the same Authorization: Bearer $CRON_SECRET
// header isCronRequestAuthorized checks) — POST remains for any manual/internal trigger.
export const GET = POST;
