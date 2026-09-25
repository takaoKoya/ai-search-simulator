import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isCronRequestAuthorized } from "@/lib/server/cronAuth";
import { runBackgroundJob } from "@/lib/server/backgroundJob";
import { computeSlaStatus } from "@/lib/server/slaEngine";

/**
 * Recomputes `approval_requests.sla_status` across ALL tenants (spec
 * §61-64) — never a naive per-request check, since nothing here has a
 * human triggering it. `sla_due_at` itself is fixed at approval-creation
 * time (lib/server/slaEngine.ts's computeSlaForEvent) and never
 * recalculated here — only the status label (ON_TRACK/DUE_SOON/BREACHED)
 * updates as time passes.
 */
export async function POST(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const result = await runBackgroundJob(supabase, "sla-check", async () => {
    const { data: approvals, error } = await supabase.from("approval_requests").select("id, sla_due_at, sla_status, created_at").eq("status", "pending").not("sla_due_at", "is", null);
    if (error) throw error;

    const now = new Date();
    let updated = 0;
    for (const approval of approvals ?? []) {
      const nextStatus = computeSlaStatus({
        dueAt: new Date(approval.sla_due_at as string),
        startAt: new Date(approval.created_at as string),
        now,
        resolved: false,
      });
      if (nextStatus !== approval.sla_status) {
        await supabase.from("approval_requests").update({ sla_status: nextStatus }).eq("id", approval.id as string);
        updated += 1;
      }
    }
    return { checked: (approvals ?? []).length, updated };
  });

  return NextResponse.json(result, { status: result.ran ? 200 : 202 });
}

// Vercel Cron Jobs invoke via GET (with the same Authorization: Bearer $CRON_SECRET
// header isCronRequestAuthorized checks) — POST remains for any manual/internal trigger.
export const GET = POST;
