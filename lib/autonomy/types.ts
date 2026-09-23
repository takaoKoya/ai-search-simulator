/**
 * Shared types for the AI Company Autonomy Runtime (PHASE 1).
 *
 * These mirror the check constraints added in
 * supabase/migrations/20260925000000_ai_company_os_phase1_autonomy_core.sql
 * exactly — keep the two in sync when either changes.
 */

import { z } from "zod";

export type AutonomyMode = "OFF" | "SHADOW" | "ASSISTED" | "ACTIVE";

export type ObjectiveStatus = "DRAFT" | "ACTIVE" | "AT_RISK" | "ACHIEVED" | "PAUSED" | "CANCELLED";

export type CycleStatus = "RUNNING" | "COMPLETED" | "FAILED" | "ESCALATED";
export const CYCLE_TERMINAL_STATUSES: readonly CycleStatus[] = ["COMPLETED", "FAILED", "ESCALATED"];

export type WorkStatus =
  | "PROPOSED"
  | "AUTHORITY_PENDING"
  | "APPROVED"
  | "DENIED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";
export const WORK_TERMINAL_STATUSES: readonly WorkStatus[] = ["COMPLETED", "DENIED", "FAILED", "BLOCKED", "CANCELLED"];

export type PlanDecision = "NO_ACTION" | "CREATE_WORK" | "REPLAN" | "ESCALATE" | "WAIT";

export type AuthorityDecision = "AUTO" | "APPROVAL" | "DENY";

export type VerificationVerdict = "PASS" | "FAIL" | "RETRY" | "ESCALATE";

export type ImpactClassification = "DIRECT_KPI_CHANGE" | "INDIRECT_CONTRIBUTION" | "NO_MEASURABLE_CHANGE" | "UNKNOWN";

/** REAL = a live LLM call. MOCK = the deterministic stand-in, allowed only in TEST/DEV/SHADOW. SIMULATED = TemplateProvider's own output, surfaced for context alongside Planner output in the same UI/logs. */
export type ProviderKind = "REAL" | "MOCK" | "SIMULATED";

export type DecisionLogStage =
  | "OBSERVE"
  | "PLAN"
  | "AUTHORIZE"
  | "EXECUTE"
  | "VERIFY"
  | "ASSESS_IMPACT"
  | "UPDATE_KPI"
  | "SUPERVISE"
  | "HUMAN_INTERVENTION";

export type DecisionLogActorType = "SYSTEM" | "AI" | "HUMAN";

export type SupervisorDecision = "COMPLETE" | "NEXT_CYCLE" | "WAIT" | "ESCALATE" | "BLOCK";

/** Actions a human can take mid-cycle; every one of these must be written to decision_logs (FINAL CHANGE 5). */
export type HumanInterventionAction = "APPROVE" | "REJECT" | "PAUSE" | "RESUME" | "CANCEL" | "OVERRIDE";

// ---------------------------------------------------------------------------
// Planner Input contract (spec FINAL CHANGE 12) — deliberately bounded. Never
// includes full conversation history, other tenants' data, or raw
// chain-of-thought from a prior cycle (only its reasoningSummary travels
// forward, via relevantDecisionSummaries).
// ---------------------------------------------------------------------------

export interface ObjectiveSnapshot {
  id: string;
  title: string;
  objectiveType: string;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  deadline: string | null;
  priority: string;
  status: ObjectiveStatus;
}

export interface KpiSnapshotForPlanner {
  id: string | null;
  name: string | null;
  currentValue: number | null;
  targetValue: number | null;
  direction: string | null;
}

export interface WorkSummary {
  id: string;
  title: string;
  status: WorkStatus;
  skillDefinitionId: string | null;
  createdAt: string;
}

export interface SkillDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  riskLevel: string;
  executorRef: string;
}

export interface PlannerInput {
  objective: ObjectiveSnapshot;
  kpiSnapshot: KpiSnapshotForPlanner;
  observation: {
    id: string;
    progress: number | null;
    expectedProgress: number | null;
    gap: number | null;
    riskLevel: string | null;
    requiresPlanning: boolean;
  };
  existingActiveWorks: WorkSummary[];
  recentCompletedWorks: WorkSummary[];
  recentFailedWorks: WorkSummary[];
  candidateSkills: SkillDefinitionSummary[];
  budgetState: { remainingDailyUsd: number | null; remainingPerCycleUsd: number | null };
  authorityConstraints: { maxWorksPerCycle: number; autonomyMode: AutonomyMode };
  autonomyMode: AutonomyMode;
  /** Last N `reasoning_summary` values from decision_logs — summaries only, never raw history. */
  relevantDecisionSummaries: string[];
}

// ---------------------------------------------------------------------------
// Planner Output contract (spec FINAL CHANGE 13) — always schema-validated.
// `confidence` and `plannerSuggestedRequiresApproval` are advisory/analytics
// only: AuthorityEngine never reads either (spec FINAL CHANGE 6).
// ---------------------------------------------------------------------------

export const ProposedWorkSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  skillDefinitionId: z.string().uuid(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  expectedOutcome: z.string().optional(),
  estimatedCost: z.number().nonnegative().default(0),
});
export type ProposedWork = z.infer<typeof ProposedWorkSchema>;

export const PlanProposalSchema = z
  .object({
    decision: z.enum(["NO_ACTION", "CREATE_WORK", "REPLAN", "ESCALATE", "WAIT"]),
    reasoningSummary: z.string().min(1),
    reasonCodes: z.array(z.string()).default([]),
    proposedWorks: z.array(ProposedWorkSchema).default([]),
    expectedImpact: z.string().optional(),
    candidateSkillIds: z.array(z.string().uuid()).default([]),
    estimatedCost: z.number().nonnegative().default(0),
    confidence: z.number().min(0).max(1),
    recommendedNextObservationAt: z.string().datetime(),
    /** Advisory only — see module doc comment and FINAL CHANGE 6/3. Never consulted by AuthorityEngine. */
    plannerSuggestedRequiresApproval: z.boolean().default(false),
  })
  .refine((v) => v.decision === "CREATE_WORK" || v.proposedWorks.length === 0, {
    message: "proposedWorks must be empty unless decision is CREATE_WORK",
    path: ["proposedWorks"],
  });
export type PlanProposal = z.infer<typeof PlanProposalSchema>;

// ---------------------------------------------------------------------------
// State transition whitelists (spec FINAL CHANGE 3/4) — the single source of
// truth for lib/autonomy/stateTransition.ts. Terminal states have no outgoing
// entry at all: an implicit reopen is structurally impossible, not just
// discouraged by convention.
// ---------------------------------------------------------------------------

export const CYCLE_TRANSITIONS: Readonly<Record<CycleStatus, readonly CycleStatus[]>> = {
  RUNNING: ["COMPLETED", "FAILED", "ESCALATED"],
  COMPLETED: [],
  FAILED: [],
  ESCALATED: [],
};

export const WORK_TRANSITIONS: Readonly<Record<WorkStatus, readonly WorkStatus[]>> = {
  PROPOSED: ["AUTHORITY_PENDING", "APPROVED", "DENIED"],
  AUTHORITY_PENDING: ["APPROVED", "DENIED"],
  APPROVED: ["EXECUTING", "CANCELLED"],
  EXECUTING: ["COMPLETED", "FAILED", "BLOCKED"],
  DENIED: [],
  COMPLETED: [],
  FAILED: [],
  BLOCKED: [],
  CANCELLED: [],
};
