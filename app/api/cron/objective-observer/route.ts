import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { isCronRequestAuthorized } from "@/lib/server/cronAuth";
import { runBackgroundJob } from "@/lib/server/backgroundJob";
import { advanceApprovedWork, runObjectiveCycle } from "@/lib/autonomy/cycleRunner";
import { reviewCycle } from "@/lib/autonomy/supervisor";

/**
 * AI Company OS Autonomy Runtime scheduler entry point (spec §13/migration
 * order step 13 — this closes PHASE 0's Root Cause #3, "no scheduler was
 * ever wired up"). Mirrors the existing cron routes' exact pattern
 * (bearer-secret auth, service-role client, runBackgroundJob's overlap
 * lock) — the only new thing here is what it does once authorized.
 *
 * Only tenants with `tenant_autonomy_settings.feature_enabled = true` (the
 * Pilot Tenant, by construction — every other tenant defaults to false and
 * is untouched) are ever processed; the Kill Switch and mode checks inside
 * each stage module (assertNotStopped) are the actual per-call guard, this
 * is just the coarse sweep filter. "cron fired" and "autonomy cycle
 * started" are logged as separate, distinguishable agent_events rows: a
 * tenant can fire the cron every tick without a cycle actually starting
 * (cooldown, max_cycles_per_objective_per_day, or no objective needing
 * planning).
 */
export async function POST(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const result = await runBackgroundJob(supabase, "objective-observer", async () => {
    const { data: pilotTenants, error } = await supabase.from("tenant_autonomy_settings").select("tenant_id").eq("feature_enabled", true);
    if (error) throw error;

    let objectivesChecked = 0;
    let cyclesStarted = 0;
    let approvedWorksAdvanced = 0;
    let failures = 0;

    for (const row of pilotTenants ?? []) {
      const tenantId = row.tenant_id as string;

      await supabase.from("agent_events").insert({
        tenant_id: tenantId,
        event_type: "autonomy.cron_fired",
        message: "objective-observer cron fired",
        payload: { route: "objective-observer" },
      });

      const { data: objectives, error: objectivesError } = await supabase.from("objectives").select("id").eq("tenant_id", tenantId).in("status", ["ACTIVE", "AT_RISK"]);
      if (objectivesError) {
        failures += 1;
        console.error(`objective-observer: failed to load objectives for tenant ${tenantId}:`, objectivesError);
        continue;
      }

      for (const objective of objectives ?? []) {
        const objectiveId = objective.id as string;
        objectivesChecked += 1;
        try {
          const cycleResult = await runObjectiveCycle(supabase, tenantId, objectiveId);
          if (!cycleResult.skipped && cycleResult.cycleId) {
            cyclesStarted += 1;
            await supabase.from("agent_events").insert({
              tenant_id: tenantId,
              event_type: "autonomy.cycle_started",
              message: `Autonomy cycle started for objective ${objectiveId}`,
              payload: { objectiveId, cycleId: cycleResult.cycleId, supervisorDecision: cycleResult.supervisorDecision ?? null },
            });
          }
        } catch (err) {
          failures += 1;
          console.error(`objective-observer: runObjectiveCycle failed for objective ${objectiveId}:`, err);
        }
      }

      // Sweep Works a human approved since a previous tick — PHASE 1 does not
      // trigger execution synchronously from decideApproval (see
      // lib/autonomy/cycleRunner.ts's doc comment on advanceApprovedWork).
      const { data: approvedWorks, error: worksError } = await supabase.from("works").select("id, cycle_id, objective_id, skill_definition_id").eq("tenant_id", tenantId).eq("status", "APPROVED");
      if (worksError) {
        failures += 1;
        console.error(`objective-observer: failed to load approved works for tenant ${tenantId}:`, worksError);
        continue;
      }

      for (const work of approvedWorks ?? []) {
        const workId = work.id as string;
        try {
          await advanceApprovedWork(supabase, tenantId, {
            workId,
            cycleId: work.cycle_id as string,
            objectiveId: work.objective_id as string,
            skillDefinitionId: work.skill_definition_id as string,
          });
          await reviewCycle(supabase, tenantId, { cycleId: work.cycle_id as string, objectiveId: work.objective_id as string });
          approvedWorksAdvanced += 1;
        } catch (err) {
          failures += 1;
          console.error(`objective-observer: advanceApprovedWork failed for work ${workId}:`, err);
        }
      }
    }

    return { tenantsChecked: (pilotTenants ?? []).length, objectivesChecked, cyclesStarted, approvedWorksAdvanced, failures };
  });

  return NextResponse.json(result, { status: result.ran ? 200 : 202 });
}

// Vercel Cron Jobs invoke via GET (with the same Authorization: Bearer $CRON_SECRET
// header isCronRequestAuthorized checks) — POST remains for any manual/internal trigger.
export const GET = POST;
