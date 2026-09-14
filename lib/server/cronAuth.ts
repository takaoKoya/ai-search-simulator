import type { NextRequest } from "next/server";

/**
 * /api/cron/* routes have no human session at all (a scheduler calls them
 * directly), so they cannot use getTenantContext()/RLS — they are gated by
 * a shared bearer secret instead, and use the service-role client
 * (lib/supabase/serviceRole.ts) once authorized.
 */
export function isCronRequestAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
