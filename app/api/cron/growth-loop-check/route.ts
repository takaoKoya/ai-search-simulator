import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isCronRequestAuthorized } from "@/lib/server/cronAuth";
import { runBackgroundJob } from "@/lib/server/backgroundJob";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

/**
 * Growth Loop Scheduler (spec §123-125): sweeps every tenant's DELIVERED (or
 * further) projects and re-runs measurement_graph (KPI Sync / Measurement
 * Window Check / Anomaly Detection / Monthly Cycle) and renewal_graph
 * (Renewal Due Check / Upsell Detection) — both graphs are themselves
 * idempotent per KPI/period (measurement_plans terminal-status guard,
 * reporting_cycles unique per period, contract_renewals unique per contract
 * end date), and this whole sweep is additionally locked by
 * runBackgroundJob so two overlapping cron ticks never run it concurrently.
 * A single project's failure never aborts the sweep for the rest (spec
 * §125: Connector/KPI failure must not break the whole Report/cycle).
 */
export async function POST(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const result = await runBackgroundJob(supabase, "growth-loop-check", async () => {
    const { data: tenants, error } = await supabase.from("tenants").select("id");
    if (error) throw error;

    let projectsChecked = 0;
    let failures = 0;
    for (const tenant of tenants ?? []) {
      const tenantId = tenant.id as string;
      const { data: projects } = await supabase.from("projects").select("id, client_id, clients(name)").eq("tenant_id", tenantId).in("status", ["ready_for_delivery", "delivered"]);

      for (const project of projects ?? []) {
        projectsChecked += 1;
        const companyName = (project as unknown as { clients: { name: string } | null }).clients?.name ?? "クライアント";
        try {
          await runBusinessGraph({
            supabase,
            tenantId,
            graphName: "measurement_graph",
            subjectType: "project",
            subjectId: project.id as string,
            input: { projectId: project.id },
          });
          await runBusinessGraph({
            supabase,
            tenantId,
            graphName: "renewal_graph",
            subjectType: "project",
            subjectId: project.id as string,
            input: { projectId: project.id, companyName },
          });
        } catch (err) {
          failures += 1;
          console.error(`growth-loop-check failed for project ${project.id as string}:`, err);
        }
      }
    }

    return { tenantsChecked: (tenants ?? []).length, projectsChecked, failures };
  });

  return NextResponse.json(result, { status: result.ran ? 200 : 202 });
}

// Vercel Cron Jobs invoke via GET (with the same Authorization: Bearer $CRON_SECRET
// header isCronRequestAuthorized checks) — POST remains for any manual/internal trigger.
export const GET = POST;
