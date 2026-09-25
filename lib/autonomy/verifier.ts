/**
 * ResultVerifier (spec §10, "unchanged from v1") — Verification is separate
 * from Execution. A graph's own self-reported `status` is never trusted as
 * the Result; this module runs deterministic checks (schema/count/
 * required-fields/status/numeric-conditions — no LLM, no self-report)
 * against the actual DB side effect the skill is supposed to have produced,
 * exactly the way spec §10 describes preferring deterministic checks.
 *
 * A failed Execution Output is never treated as a Business Result: only a
 * PASS verdict here is a Verified Result, and only a Verified Result may
 * ever reach ImpactAssessor/KPI update (lib/autonomy/impactAssessor.ts).
 */

import type { SupabaseServerClient } from "@/lib/server/tenant";
import type { VerificationVerdict } from "@/lib/autonomy/types";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

/** PHASE 1 only knows how to verify the two Skills the pilot vertical slice exercises (same boundary as lib/autonomy/executionAdapter.ts). */
async function checkMeasurementGraph(supabase: SupabaseServerClient, tenantId: string, projectId: string): Promise<VerificationCheck[]> {
  const { data, error } = await supabase
    .from("kpi_snapshots")
    .select("id, value")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("snapshot_type", "CURRENT")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const latest = (data ?? [])[0] as { id: string; value: number | null } | undefined;

  return [
    { name: "CURRENT_KPI_SNAPSHOT_EXISTS", passed: Boolean(latest), detail: latest ? `snapshot ${latest.id}` : "no CURRENT kpi_snapshots row found for this project" },
    { name: "SNAPSHOT_VALUE_PRESENT", passed: latest != null && latest.value != null, detail: latest ? `value=${latest.value}` : undefined },
  ];
}

async function checkRenewalGraph(supabase: SupabaseServerClient, tenantId: string, projectId: string): Promise<VerificationCheck[]> {
  const { data, error } = await supabase
    .from("contract_renewals")
    .select("id, risk_level")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const latest = (data ?? [])[0] as { id: string; risk_level: string | null } | undefined;

  return [
    { name: "CONTRACT_RENEWAL_ROW_EXISTS", passed: Boolean(latest), detail: latest ? `renewal ${latest.id}` : "no contract_renewals row found for this project" },
    { name: "RISK_LEVEL_ASSIGNED", passed: latest?.risk_level != null, detail: latest?.risk_level ?? undefined },
  ];
}

/** Verdict is derived purely from the deterministic checks — never from the graph's self-reported status alone. */
export function deriveVerdict(checks: VerificationCheck[]): VerificationVerdict {
  if (checks.length === 0) return "ESCALATE";
  return checks.every((c) => c.passed) ? "PASS" : "FAIL";
}

export interface VerifyExecutionParams {
  cycleId: string;
  objectiveId: string;
  workId: string;
  workflowRunId?: string | null;
  skillExecutorRef: string;
  projectId: string | null;
}

export interface VerifyExecutionResult {
  verificationId: string;
  verdict: VerificationVerdict;
  checks: VerificationCheck[];
}

export async function verifyExecution(supabase: SupabaseServerClient, tenantId: string, params: VerifyExecutionParams): Promise<VerifyExecutionResult> {
  let checks: VerificationCheck[];
  // Overrides deriveVerdict's PASS/FAIL for the two "we don't know how to
  // verify this at all" cases — a configuration/scope gap, not a business
  // result that ran and failed, so it must escalate to a human rather than
  // read as an ordinary FAIL.
  let verdictOverride: VerificationVerdict | null = null;

  if (!params.projectId) {
    checks = [{ name: "PROJECT_LINK_PRESENT", passed: false, detail: "objective has no linked project_id; nothing to verify against" }];
    verdictOverride = "ESCALATE";
  } else if (params.skillExecutorRef === "measurement_graph") {
    checks = await checkMeasurementGraph(supabase, tenantId, params.projectId);
  } else if (params.skillExecutorRef === "renewal_graph") {
    checks = await checkRenewalGraph(supabase, tenantId, params.projectId);
  } else {
    checks = [{ name: "SKILL_VERIFIABLE", passed: false, detail: `no deterministic check is defined for skill "${params.skillExecutorRef}"` }];
    verdictOverride = "ESCALATE";
  }

  const verdict = verdictOverride ?? deriveVerdict(checks);

  const { data, error } = await supabase
    .from("verifications")
    .insert({ tenant_id: tenantId, cycle_id: params.cycleId, work_id: params.workId, workflow_run_id: params.workflowRunId ?? null, verdict, checks })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create verifications row");

  await writeDecisionLog(supabase, tenantId, {
    cycleId: params.cycleId,
    objectiveId: params.objectiveId,
    workId: params.workId,
    stage: "VERIFY",
    actorType: "SYSTEM",
    action: verdict,
    reasoningSummary: checks.map((c) => `${c.name}=${c.passed ? "PASS" : "FAIL"}`).join(", "),
    reasonCodes: [`VERIFY_${verdict}`],
  });

  if (verdict === "PASS" || verdict === "FAIL") {
    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: verdict === "PASS" ? "verification.passed" : "verification.failed",
      message: verdict === "PASS" ? "検証合格" : "検証不合格",
      payload: { objectiveId: params.objectiveId, cycleId: params.cycleId, workId: params.workId },
    });
  }

  return { verificationId: data.id as string, verdict, checks };
}
