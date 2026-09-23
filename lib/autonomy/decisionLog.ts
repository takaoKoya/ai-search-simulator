/**
 * Shared decision_logs writer (spec FINAL CHANGE 5) — every stage
 * (Observer/Planner/Authority/Execution/Verify/Impact/Supervisor) and every
 * human intervention writes through this one function, so the shape of a
 * decision_logs row is identical regardless of which stage produced it.
 * Previously each stage module had its own near-identical local copy of
 * this; consolidated here per the authorized plan's own note that this
 * should happen once more than one stage needed it.
 *
 * `actor_type` is what makes a decision_logs row AI-made vs human-made
 * traceable after the fact (spec FINAL CHANGE 5): SYSTEM for deterministic
 * stages (Observer, AuthorityEngine, Execution, Verify, Impact), AI only for
 * CompanyPlanner's LLM-backed decision, HUMAN only for an actual
 * Approve/Reject/Pause/Resume/Cancel/Override.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import type { DecisionLogActorType, DecisionLogStage } from "@/lib/autonomy/types";

export interface WriteDecisionLogParams {
  cycleId: string;
  objectiveId?: string | null;
  workId?: string | null;
  stage: DecisionLogStage;
  actorType: DecisionLogActorType;
  actorId?: string | null;
  action: string;
  reasoningSummary?: string | null;
  reasonCodes?: string[];
}

export async function writeDecisionLog(supabase: SupabaseServerClient, tenantId: string, params: WriteDecisionLogParams): Promise<void> {
  const { error } = await supabase.from("decision_logs").insert({
    tenant_id: tenantId,
    cycle_id: params.cycleId,
    objective_id: params.objectiveId ?? null,
    work_id: params.workId ?? null,
    stage: params.stage,
    actor_type: params.actorType,
    actor_id: params.actorId ?? null,
    action: params.action,
    reasoning_summary: params.reasoningSummary ?? null,
    reason_codes: params.reasonCodes ?? [],
  });
  if (error) throw error;
}
