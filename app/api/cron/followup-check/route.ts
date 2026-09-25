import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isCronRequestAuthorized } from "@/lib/server/cronAuth";
import { runBackgroundJob } from "@/lib/server/backgroundJob";
import { loadBusinessCalendar } from "@/lib/server/slaEngine";
import { checkFollowupsForTenant } from "@/lib/server/followupCheck";

/**
 * Runs the Follow-up Engine (spec §67-71) across every tenant. Creates only
 * human-approvable Candidates — never sends anything (see
 * lib/sales/followupEngine.ts and lib/server/followupCheck.ts).
 */
export async function POST(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const result = await runBackgroundJob(supabase, "followup-check", async () => {
    const { data: tenants, error } = await supabase.from("tenants").select("id");
    if (error) throw error;

    let candidatesCreated = 0;
    for (const tenant of tenants ?? []) {
      const tenantId = tenant.id as string;
      const calendar = await loadBusinessCalendar(supabase, tenantId);
      const { created } = await checkFollowupsForTenant(supabase, tenantId, calendar);
      candidatesCreated += created;
    }
    return { tenantsChecked: (tenants ?? []).length, candidatesCreated };
  });

  return NextResponse.json(result, { status: result.ran ? 200 : 202 });
}

// Vercel Cron Jobs invoke via GET (with the same Authorization: Bearer $CRON_SECRET
// header isCronRequestAuthorized checks) — POST remains for any manual/internal trigger.
export const GET = POST;
