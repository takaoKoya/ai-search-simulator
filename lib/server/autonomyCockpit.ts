import type { TenantContext } from "@/lib/server/tenant";
import { getTenantAutonomySettings, type TenantAutonomySettingsRow } from "@/lib/autonomy/killSwitch";
import { listObjectives } from "@/lib/server/objectives";

/**
 * Minimum Pilot Cockpit data (spec §17/UI). A read-only projection of
 * runtime state already written by the Autonomy Runtime stages — nothing
 * here is synthesized, matching the same "no placeholder constants" ethos
 * lib/server/officeState.ts already follows for the rest of the AI Office.
 * AI Office remains a Runtime-State projection (spec FINAL CHANGE 2):
 * this reads autonomy_cycles/works/decision_logs/etc. directly, it never
 * introduces a second state store.
 */

interface KpiSummary {
  id: string;
  name: string | null;
  currentValue: number | null;
  targetValue: number | null;
}

interface CycleSummary {
  id: string;
  cycleNumber: number;
  status: string;
}

interface PlanSummary {
  decision: string;
  reasoningSummary: string;
  providerKind: string;
}

interface WorkSummary {
  id: string;
  title: string;
  status: string;
  authorityDecision: string | null;
}

export interface AutonomyCockpitObjective {
  id: string;
  title: string;
  status: string;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  kpi: KpiSummary | null;
  currentCycle: CycleSummary | null;
  latestPlan: PlanSummary | null;
  latestWork: WorkSummary | null;
  latestVerification: { verdict: string } | null;
  latestImpact: { classification: string } | null;
  supervisorDecision: string | null;
  pendingApproval: { id: string; title: string } | null;
}

export interface AutonomyCockpitState {
  settings: TenantAutonomySettingsRow | null;
  costToday: { reservedUsd: number; reconciledUsd: number; dailyLimitUsd: number | null } | null;
  objectives: AutonomyCockpitObjective[];
}

async function getKpiForObjective(ctx: TenantContext, objectiveId: string): Promise<KpiSummary | null> {
  const { data, error } = await ctx.supabase
    .from("kpis")
    .select("id, name, current_value, target_value")
    .eq("tenant_id", ctx.tenantId)
    .eq("objective_id", objectiveId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as string, name: (data.name as string | null) ?? null, currentValue: (data.current_value as number | null) ?? null, targetValue: (data.target_value as number | null) ?? null };
}

async function getLatestCycle(ctx: TenantContext, objectiveId: string): Promise<CycleSummary | null> {
  const { data, error } = await ctx.supabase
    .from("autonomy_cycles")
    .select("id, cycle_number, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("objective_id", objectiveId)
    .order("cycle_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as string, cycleNumber: data.cycle_number as number, status: data.status as string };
}

async function getLatestPlan(ctx: TenantContext, cycleId: string): Promise<PlanSummary | null> {
  const { data, error } = await ctx.supabase
    .from("plan_proposals")
    .select("decision, reasoning_summary, provider_kind")
    .eq("tenant_id", ctx.tenantId)
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { decision: data.decision as string, reasoningSummary: data.reasoning_summary as string, providerKind: data.provider_kind as string };
}

async function getLatestWork(ctx: TenantContext, cycleId: string): Promise<WorkSummary | null> {
  const { data, error } = await ctx.supabase
    .from("works")
    .select("id, title, status, authority_decision")
    .eq("tenant_id", ctx.tenantId)
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as string, title: data.title as string, status: data.status as string, authorityDecision: (data.authority_decision as string | null) ?? null };
}

async function getLatestVerification(ctx: TenantContext, workId: string): Promise<{ verdict: string } | null> {
  const { data, error } = await ctx.supabase.from("verifications").select("verdict").eq("tenant_id", ctx.tenantId).eq("work_id", workId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? { verdict: data.verdict as string } : null;
}

async function getLatestImpact(ctx: TenantContext, workId: string): Promise<{ classification: string } | null> {
  const { data, error } = await ctx.supabase
    .from("impact_assessments")
    .select("classification")
    .eq("tenant_id", ctx.tenantId)
    .eq("work_id", workId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { classification: data.classification as string } : null;
}

async function getSupervisorDecision(ctx: TenantContext, cycleId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("decision_logs")
    .select("action")
    .eq("tenant_id", ctx.tenantId)
    .eq("cycle_id", cycleId)
    .eq("stage", "SUPERVISE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.action as string | undefined) ?? null;
}

async function getPendingApprovalForWork(ctx: TenantContext, workId: string): Promise<{ id: string; title: string } | null> {
  const { data, error } = await ctx.supabase
    .from("approval_requests")
    .select("id, title")
    .eq("tenant_id", ctx.tenantId)
    .eq("type", "work_creation")
    .eq("subject_id", workId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, title: data.title as string } : null;
}

async function getCostToday(ctx: TenantContext, now: Date = new Date()): Promise<{ reserved_total_usd: number; reconciled_total_usd: number } | null> {
  const ledgerDate = now.toISOString().slice(0, 10);
  const { data, error } = await ctx.supabase.from("cost_ledgers").select("reserved_total_usd, reconciled_total_usd").eq("tenant_id", ctx.tenantId).eq("ledger_date", ledgerDate).maybeSingle();
  if (error) throw error;
  return (data as { reserved_total_usd: number; reconciled_total_usd: number } | null) ?? null;
}

async function buildObjectiveSummary(ctx: TenantContext, objective: { id: string; title: string; status: string; target_value: number | null; current_value: number | null; unit: string | null }): Promise<AutonomyCockpitObjective> {
  const [kpi, cycle] = await Promise.all([getKpiForObjective(ctx, objective.id), getLatestCycle(ctx, objective.id)]);

  let latestPlan: PlanSummary | null = null;
  let latestWork: WorkSummary | null = null;
  let supervisorDecision: string | null = null;
  let latestVerification: { verdict: string } | null = null;
  let latestImpact: { classification: string } | null = null;
  let pendingApproval: { id: string; title: string } | null = null;

  if (cycle) {
    [latestPlan, latestWork, supervisorDecision] = await Promise.all([getLatestPlan(ctx, cycle.id), getLatestWork(ctx, cycle.id), getSupervisorDecision(ctx, cycle.id)]);
    if (latestWork) {
      [latestVerification, latestImpact, pendingApproval] = await Promise.all([
        getLatestVerification(ctx, latestWork.id),
        getLatestImpact(ctx, latestWork.id),
        getPendingApprovalForWork(ctx, latestWork.id),
      ]);
    }
  }

  return {
    id: objective.id,
    title: objective.title,
    status: objective.status,
    targetValue: objective.target_value,
    currentValue: objective.current_value,
    unit: objective.unit,
    kpi,
    currentCycle: cycle,
    latestPlan,
    latestWork,
    latestVerification,
    latestImpact,
    supervisorDecision,
    pendingApproval,
  };
}

export async function getAutonomyCockpitState(ctx: TenantContext): Promise<AutonomyCockpitState> {
  const [settings, objectiveRows, costTodayRow] = await Promise.all([getTenantAutonomySettings(ctx.supabase, ctx.tenantId), listObjectives(ctx.supabase, ctx.tenantId), getCostToday(ctx)]);

  const objectives = await Promise.all(objectiveRows.map((objective) => buildObjectiveSummary(ctx, objective)));

  return {
    settings,
    costToday: costTodayRow ? { reservedUsd: costTodayRow.reserved_total_usd, reconciledUsd: costTodayRow.reconciled_total_usd, dailyLimitUsd: settings?.daily_cost_limit_usd ?? null } : null,
    objectives,
  };
}
