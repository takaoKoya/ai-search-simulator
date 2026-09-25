import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/**
 * Service-role Supabase client — bypasses RLS entirely. This is a
 * deliberate, narrowly-scoped exception to this codebase's "never use a
 * service-role key" rule, reserved for exactly two request paths that have
 * no human session to derive tenant_id/RLS context from:
 *
 *   1. /api/cron/* scheduled-job routes (gated by CRON_SECRET) — a
 *      background job has no human request at all.
 *   2. Signed-URL file redemption (spec §48) — an external client
 *      downloading a shared file has no Supabase Auth session in this
 *      system at all; the signed token itself (HMAC-verified,
 *      short-lived) is the security boundary, not RLS.
 *
 * Never use this client for a route that has a normal authenticated tenant
 * session available — use lib/supabase/server.ts (RLS-enforced) there
 * instead.
 */
export function createServiceRoleClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createSupabaseClient(url, serviceRoleKey, { auth: { persistSession: false } });
}
