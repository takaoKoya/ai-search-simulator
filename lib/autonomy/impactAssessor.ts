/**
 * ImpactAssessor (spec FINAL CHANGE 1) — Execution success ≠ KPI change.
 * Classifies a Verified Result (never anything less than a PASS verdict —
 * "a failed Execution Output is never treated as a Business Result") into
 * DIRECT_KPI_CHANGE / INDIRECT_CONTRIBUTION / NO_MEASURABLE_CHANGE / UNKNOWN.
 * Deterministic and rule-based, per spec — no LLM call is required or made.
 *
 * Only DIRECT_KPI_CHANGE may ever be understood as a KPI update, and even
 * then this module never writes `kpis.current_value` itself: for PHASE 1's
 * one KPI-affecting Skill (measurement_graph, an existing, unchanged graph)
 * the real write already happened as part of that graph's own execution —
 * from a verified source, never from inference. This module's job is to
 * recognize and record that fact, not to duplicate the write.
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import type { ImpactClassification, VerificationVerdict } from "@/lib/autonomy/types";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";

interface KpiSnapshotPoint {
  value: number | null;
}

export interface ImpactClassificationInput {
  verdict: VerificationVerdict;
  skillExecutorRef: string;
  /** CURRENT kpi_snapshots for the objective's linked KPI, newest first. Empty when the skill/verdict doesn't call for a KPI comparison at all. */
  recentKpiSnapshots: KpiSnapshotPoint[];
}

export interface ImpactClassificationOutput {
  classification: ImpactClassification;
  rationale: string;
}

/** Pure classification rule — no DB access, so it is trivially unit-testable and structurally cannot depend on anything but its explicit input. */
export function classifyImpact(input: ImpactClassificationInput): ImpactClassificationOutput {
  if (input.verdict !== "PASS") {
    return { classification: "UNKNOWN", rationale: `Verification verdict was ${input.verdict}, not PASS; impact was not assessed.` };
  }

  if (input.skillExecutorRef === "measurement_graph") {
    const [latest, previous] = input.recentKpiSnapshots;
    if (!latest || latest.value == null) {
      return { classification: "NO_MEASURABLE_CHANGE", rationale: "No CURRENT KPI snapshot value was recorded by this execution." };
    }
    if (!previous || previous.value == null) {
      return { classification: "DIRECT_KPI_CHANGE", rationale: "First recorded KPI measurement — establishing a baseline is itself a direct KPI change." };
    }
    return latest.value !== previous.value
      ? { classification: "DIRECT_KPI_CHANGE", rationale: `KPI value changed from ${previous.value} to ${latest.value}.` }
      : { classification: "NO_MEASURABLE_CHANGE", rationale: `KPI value unchanged at ${latest.value}.` };
  }

  if (input.skillExecutorRef === "renewal_graph") {
    return { classification: "INDIRECT_CONTRIBUTION", rationale: "renewal_graph assesses renewal/upsell risk; it does not itself write a KPI value." };
  }

  return { classification: "UNKNOWN", rationale: `No impact-classification rule is defined for skill "${input.skillExecutorRef}".` };
}

async function fetchKpiForObjective(supabase: SupabaseServerClient, tenantId: string, objectiveId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase.from("kpis").select("id").eq("tenant_id", tenantId).eq("objective_id", objectiveId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

async function fetchRecentCurrentSnapshots(supabase: SupabaseServerClient, tenantId: string, kpiId: string): Promise<KpiSnapshotPoint[]> {
  const { data, error } = await supabase
    .from("kpi_snapshots")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("kpi_id", kpiId)
    .eq("snapshot_type", "CURRENT")
    .order("created_at", { ascending: false })
    .limit(2);
  if (error) throw error;
  return (data ?? []) as KpiSnapshotPoint[];
}

export interface AssessImpactParams {
  cycleId: string;
  objectiveId: string;
  workId: string;
  verificationId: string;
  skillExecutorRef: string;
  verdict: VerificationVerdict;
}

export interface AssessImpactResult {
  impactAssessmentId: string;
  classification: ImpactClassification;
  rationale: string;
}

export async function assessImpact(supabase: SupabaseServerClient, tenantId: string, params: AssessImpactParams): Promise<AssessImpactResult> {
  const kpi = params.verdict === "PASS" && params.skillExecutorRef === "measurement_graph" ? await fetchKpiForObjective(supabase, tenantId, params.objectiveId) : null;
  const recentKpiSnapshots = kpi ? await fetchRecentCurrentSnapshots(supabase, tenantId, kpi.id) : [];

  const { classification, rationale } = classifyImpact({ verdict: params.verdict, skillExecutorRef: params.skillExecutorRef, recentKpiSnapshots });

  const { data, error } = await supabase
    .from("impact_assessments")
    .insert({
      tenant_id: tenantId,
      cycle_id: params.cycleId,
      work_id: params.workId,
      verification_id: params.verificationId,
      objective_id: params.objectiveId,
      kpi_id: kpi?.id ?? null,
      classification,
      rationale,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create impact_assessments row");

  await writeDecisionLog(supabase, tenantId, {
    cycleId: params.cycleId,
    objectiveId: params.objectiveId,
    workId: params.workId,
    stage: "ASSESS_IMPACT",
    actorType: "SYSTEM",
    action: classification,
    reasoningSummary: rationale,
    reasonCodes: [`IMPACT_${classification}`],
  });

  if (classification === "DIRECT_KPI_CHANGE") {
    await writeDecisionLog(supabase, tenantId, {
      cycleId: params.cycleId,
      objectiveId: params.objectiveId,
      workId: params.workId,
      stage: "UPDATE_KPI",
      actorType: "SYSTEM",
      action: "KPI_ALREADY_UPDATED_BY_VERIFIED_SKILL",
      reasoningSummary: "measurement_graph itself wrote kpis.current_value as part of its own (unchanged) execution; no separate write is made here.",
    });
  }

  return { impactAssessmentId: data.id as string, classification, rationale };
}
