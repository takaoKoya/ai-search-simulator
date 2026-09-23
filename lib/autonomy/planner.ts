/**
 * CompanyPlanner — judgment and proposal only (spec §7/FINAL CHANGE 6/12/13).
 *
 * The Planner never creates Work, never executes a Skill, never sends email,
 * never runs a workflow, and never decides an approval — those all happen
 * downstream of AuthorityEngine, in later stages. What it DOES write is its
 * own output record (`plan_proposals`), by the same precedent ObjectiveObserver
 * already set for `objective_observations`: a stage may persist its own
 * audit-of-record, but never another stage's state.
 *
 * `confidence` and `plannerSuggestedRequiresApproval` on the resulting
 * PlanProposal are advisory/analytics fields only — AuthorityEngine (a later
 * task) must never read either when deciding AUTO/APPROVAL/DENY.
 */

import type { ZodType } from "zod";
import type { SupabaseServerClient } from "@/lib/server/tenant";
import { assertNotStopped, type TenantAutonomySettingsRow } from "@/lib/autonomy/killSwitch";
import { getObjective } from "@/lib/server/objectives";
import { resolveCandidateSkills } from "@/lib/autonomy/skillCandidateResolver";
import { transitionCycle } from "@/lib/autonomy/stateTransition";
import { getLLMProvider, type GetLLMProviderOptions, type LLMGenerateParams, type MockRespondFn, type ProviderKind } from "@/lib/ai/llmProvider";
import {
  PlanProposalSchema,
  WORK_TERMINAL_STATUSES,
  type ObjectiveSnapshot,
  type PlanProposal,
  type PlannerInput,
  type WorkStatus,
  type WorkSummary,
} from "@/lib/autonomy/types";

const RECENT_WORKS_LIMIT = 20;
const RELEVANT_SUMMARIES_LIMIT = 5;
const DEFAULT_NEXT_OBSERVATION_DELAY_MS = 24 * 60 * 60 * 1000;

export interface PlanForCycleParams {
  cycleId: string;
  objectiveId: string;
  llmOptions?: Pick<GetLLMProviderOptions, "apiKeyOverride" | "timeoutMs">;
}

export interface PlanForCycleResult {
  planProposalId: string;
  proposal: PlanProposal;
  providerKind: ProviderKind;
  plannerInput: PlannerInput;
}

async function fetchRecentWorks(supabase: SupabaseServerClient, tenantId: string, objectiveId: string): Promise<WorkSummary[]> {
  const { data, error } = await supabase
    .from("works")
    .select("id, title, status, skill_definition_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .order("created_at", { ascending: false })
    .limit(RECENT_WORKS_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as WorkStatus,
    skillDefinitionId: (row.skill_definition_id as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

async function fetchLatestObservationForCycle(supabase: SupabaseServerClient, tenantId: string, cycleId: string) {
  const { data, error } = await supabase
    .from("objective_observations")
    .select("id, progress, expected_progress, gap, risk_level, requires_planning")
    .eq("tenant_id", tenantId)
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; progress: number | null; expected_progress: number | null; gap: number | null; risk_level: string | null; requires_planning: boolean } | null;
}

async function fetchLatestKpiSnapshot(supabase: SupabaseServerClient, tenantId: string, objectiveId: string): Promise<PlannerInput["kpiSnapshot"]> {
  const { data, error } = await supabase
    .from("kpis")
    .select("id, name, current_value, target_value, direction")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { id: null, name: null, currentValue: null, targetValue: null, direction: null };
  return {
    id: data.id as string,
    name: data.name as string | null,
    currentValue: data.current_value as number | null,
    targetValue: data.target_value as number | null,
    direction: data.direction as string | null,
  };
}

async function fetchRelevantDecisionSummaries(supabase: SupabaseServerClient, tenantId: string, objectiveId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("decision_logs")
    .select("reasoning_summary")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .order("created_at", { ascending: false })
    .limit(RELEVANT_SUMMARIES_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => row.reasoning_summary as string | null).filter((summary): summary is string => Boolean(summary));
}

interface BuiltPlannerContext {
  input: PlannerInput;
  observationId: string | null;
}

async function buildPlannerContext(
  supabase: SupabaseServerClient,
  tenantId: string,
  settings: TenantAutonomySettingsRow,
  objectiveId: string,
  cycleId: string
): Promise<BuiltPlannerContext> {
  const objectiveRow = await getObjective(supabase, tenantId, objectiveId);
  const objective: ObjectiveSnapshot = {
    id: objectiveRow.id,
    title: objectiveRow.title,
    objectiveType: objectiveRow.objective_type,
    targetValue: objectiveRow.target_value,
    currentValue: objectiveRow.current_value,
    unit: objectiveRow.unit,
    deadline: objectiveRow.deadline,
    priority: objectiveRow.priority,
    status: objectiveRow.status,
  };

  const [kpiSnapshot, observationRow, recentWorks, candidateSkills, relevantDecisionSummaries] = await Promise.all([
    fetchLatestKpiSnapshot(supabase, tenantId, objectiveId),
    fetchLatestObservationForCycle(supabase, tenantId, cycleId),
    fetchRecentWorks(supabase, tenantId, objectiveId),
    resolveCandidateSkills(supabase, tenantId),
    fetchRelevantDecisionSummaries(supabase, tenantId, objectiveId),
  ]);

  const existingActiveWorks = recentWorks.filter((w) => !WORK_TERMINAL_STATUSES.includes(w.status));
  const recentCompletedWorks = recentWorks.filter((w) => w.status === "COMPLETED");
  const recentFailedWorks = recentWorks.filter((w) => w.status === "FAILED" || w.status === "BLOCKED");

  const input: PlannerInput = {
    objective,
    kpiSnapshot,
    observation: {
      id: observationRow?.id ?? "",
      progress: observationRow?.progress ?? null,
      expectedProgress: observationRow?.expected_progress ?? null,
      gap: observationRow?.gap ?? null,
      riskLevel: observationRow?.risk_level ?? null,
      requiresPlanning: observationRow?.requires_planning ?? false,
    },
    existingActiveWorks,
    recentCompletedWorks,
    recentFailedWorks,
    candidateSkills,
    // Cost Guardrail (task #81) is not wired in yet — left null rather than
    // echoing the tenant's total limit back as a misleading "remaining".
    budgetState: { remainingDailyUsd: null, remainingPerCycleUsd: null },
    authorityConstraints: { maxWorksPerCycle: settings.max_works_per_cycle, autonomyMode: settings.autonomy_mode },
    autonomyMode: settings.autonomy_mode,
    relevantDecisionSummaries,
  };

  return { input, observationId: observationRow?.id ?? null };
}

export function buildPlannerPrompt(input: PlannerInput): LLMGenerateParams {
  const system =
    "You are CompanyPlanner, the planning module of an autonomous AI company runtime. " +
    "You analyze the company's Objective/KPI/Observation/Work state and PROPOSE a single decision. " +
    "You never execute actions, never send communications, never approve anything, and never write " +
    "directly to company systems — you only produce a proposal for a separate Authority stage to act on.";

  const prompt = [
    "Given the following company state, decide one of: NO_ACTION, CREATE_WORK, REPLAN, ESCALATE, WAIT.",
    "If (and only if) the decision is CREATE_WORK, include one or more proposedWorks, each referencing a candidate skill's id as skillDefinitionId.",
    "",
    JSON.stringify(input, null, 2),
  ].join("\n");

  return { system, prompt };
}

/** Priority ranking used only to size the deterministic Mock's proposed work — never consulted by AuthorityEngine (spec FINAL CHANGE 6). */
function priorityForRisk(riskLevel: string | null): "low" | "medium" | "high" | "critical" {
  switch (riskLevel) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    default:
      return "low";
  }
}

/**
 * The Planner's own deterministic PlanProposal-building logic (see
 * lib/ai/llmProvider.ts module doc — Mock is intentionally a plain
 * scriptable shell, not a generic schema-filler). Used as MockLLMProvider's
 * `respond` function whenever OFF/SHADOW selects Mock. Closes over the
 * already-built PlannerInput rather than parsing the prompt text back out.
 */
export function buildDeterministicMockRespond(input: PlannerInput): MockRespondFn {
  return (): unknown => {
    const nextObservationAt = new Date(Date.now() + DEFAULT_NEXT_OBSERVATION_DELAY_MS).toISOString();

    if (!input.observation.requiresPlanning) {
      return {
        decision: "NO_ACTION",
        reasoningSummary: "Observation does not require planning; no risk threshold was crossed.",
        reasonCodes: ["DETERMINISTIC_MOCK", "NO_PLANNING_REQUIRED"],
        proposedWorks: [],
        candidateSkillIds: [],
        estimatedCost: 0,
        confidence: 1,
        recommendedNextObservationAt: nextObservationAt,
        plannerSuggestedRequiresApproval: false,
      };
    }

    if (input.existingActiveWorks.length > 0) {
      return {
        decision: "WAIT",
        reasoningSummary: `${input.existingActiveWorks.length} active work(s) already in flight for this objective; waiting for resolution before proposing another.`,
        reasonCodes: ["DETERMINISTIC_MOCK", "ACTIVE_WORK_IN_FLIGHT"],
        proposedWorks: [],
        candidateSkillIds: input.existingActiveWorks.map((w) => w.skillDefinitionId).filter((id): id is string => Boolean(id)),
        estimatedCost: 0,
        confidence: 0.7,
        recommendedNextObservationAt: nextObservationAt,
        plannerSuggestedRequiresApproval: false,
      };
    }

    if (input.candidateSkills.length === 0) {
      return {
        decision: "ESCALATE",
        reasoningSummary: "Observation requires planning but no enabled candidate skills are available to address it.",
        reasonCodes: ["DETERMINISTIC_MOCK", "NO_CANDIDATE_SKILLS"],
        proposedWorks: [],
        candidateSkillIds: [],
        estimatedCost: 0,
        confidence: 0.5,
        recommendedNextObservationAt: nextObservationAt,
        plannerSuggestedRequiresApproval: true,
      };
    }

    const skill = input.candidateSkills[0];
    return {
      decision: "CREATE_WORK",
      reasoningSummary: `Objective "${input.objective.title}" is at risk (${input.observation.riskLevel}); proposing work against skill "${skill.name}".`,
      reasonCodes: ["DETERMINISTIC_MOCK", `RISK_${input.observation.riskLevel}`],
      proposedWorks: [
        {
          title: `Address ${input.objective.title} risk via ${skill.name}`,
          skillDefinitionId: skill.id,
          priority: priorityForRisk(input.observation.riskLevel),
          expectedOutcome: `Improve progress toward objective "${input.objective.title}"`,
          estimatedCost: 0,
        },
      ],
      candidateSkillIds: [skill.id],
      estimatedCost: 0,
      confidence: 0.6,
      recommendedNextObservationAt: nextObservationAt,
      plannerSuggestedRequiresApproval: false,
    };
  };
}

async function recordPlanProposal(
  supabase: SupabaseServerClient,
  tenantId: string,
  params: { objectiveId: string; cycleId: string; observationId: string | null; proposal: PlanProposal; providerKind: ProviderKind }
): Promise<string> {
  const { data, error } = await supabase
    .from("plan_proposals")
    .insert({
      tenant_id: tenantId,
      objective_id: params.objectiveId,
      cycle_id: params.cycleId,
      observation_id: params.observationId,
      decision: params.proposal.decision,
      reasoning_summary: params.proposal.reasoningSummary,
      reason_codes: params.proposal.reasonCodes,
      proposed_works: params.proposal.proposedWorks,
      expected_impact: params.proposal.expectedImpact ?? null,
      candidate_skill_ids: params.proposal.candidateSkillIds,
      estimated_cost: params.proposal.estimatedCost,
      confidence: params.proposal.confidence,
      recommended_next_observation_at: params.proposal.recommendedNextObservationAt,
      planner_suggested_requires_approval: params.proposal.plannerSuggestedRequiresApproval,
      provider_kind: params.providerKind,
      status: "RECORDED",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create plan_proposals row");
  return data.id as string;
}

async function writeDecisionLog(
  supabase: SupabaseServerClient,
  tenantId: string,
  params: { cycleId: string; objectiveId: string; actorType: "SYSTEM" | "AI"; action: string; reasoningSummary?: string; reasonCodes?: string[] }
): Promise<void> {
  const { error } = await supabase.from("decision_logs").insert({
    tenant_id: tenantId,
    cycle_id: params.cycleId,
    objective_id: params.objectiveId,
    stage: "PLAN",
    actor_type: params.actorType,
    action: params.action,
    reasoning_summary: params.reasoningSummary ?? null,
    reason_codes: params.reasonCodes ?? [],
  });
  if (error) throw error;
}

/**
 * Runs one Planning stage for an already-observed cycle. Reads company state,
 * calls the (Fail-Closed-selected) LLMProvider, validates its output against
 * PlanProposalSchema, records the resulting PlanProposal, and logs the
 * decision (spec FINAL CHANGE 5: actor_type AI, so it is distinguishable from
 * a human decision). Any failure here transitions the cycle to FAILED and
 * logs a SYSTEM decision — never swallowed (spec FINAL CHANGE 7).
 */
export async function planForCycle(supabase: SupabaseServerClient, tenantId: string, params: PlanForCycleParams): Promise<PlanForCycleResult> {
  const settings = await assertNotStopped(supabase, tenantId);
  const { input, observationId } = await buildPlannerContext(supabase, tenantId, settings, params.objectiveId, params.cycleId);

  try {
    const provider = getLLMProvider(settings.autonomy_mode, {
      ...params.llmOptions,
      mockRespond: buildDeterministicMockRespond(input),
    });

    const generateParams = buildPlannerPrompt(input);
    const result = await provider.generateStructured<PlanProposal>(PlanProposalSchema as unknown as ZodType<PlanProposal>, generateParams);

    const planProposalId = await recordPlanProposal(supabase, tenantId, {
      objectiveId: params.objectiveId,
      cycleId: params.cycleId,
      observationId,
      proposal: result.data,
      providerKind: result.providerKind,
    });

    await writeDecisionLog(supabase, tenantId, {
      cycleId: params.cycleId,
      objectiveId: params.objectiveId,
      actorType: "AI",
      action: result.data.decision,
      reasoningSummary: result.data.reasoningSummary,
      reasonCodes: result.data.reasonCodes,
    });

    return { planProposalId, proposal: result.data, providerKind: result.providerKind, plannerInput: input };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionCycle(supabase, tenantId, params.cycleId, "FAILED", { outcome: message });
    await writeDecisionLog(supabase, tenantId, { cycleId: params.cycleId, objectiveId: params.objectiveId, actorType: "SYSTEM", action: "PLAN_FAILED", reasoningSummary: message, reasonCodes: ["PLANNER_ERROR"] });
    throw err;
  }
}
