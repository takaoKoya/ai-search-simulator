import type { SupabaseServerClient } from "@/lib/server/tenant";
import type { ApprovalStep } from "@/lib/server/approvalPolicy";

export interface AgentRow {
  id: string;
  code: string;
  name: string;
  role: string;
  provider: string;
  model: string | null;
}

/**
 * Per-invocation context shared (via closure) by every node of a graph.
 * Carries the tenant-scoped Supabase client (RLS enforced under the acting
 * user's session — never a service-role key) plus the identifiers needed to
 * attribute agent_runs/agent_events/approval_requests to this workflow run.
 */
export interface GraphRunCtx {
  supabase: SupabaseServerClient;
  tenantId: string;
  workflowRunId: string;
  agentCache: Map<string, AgentRow>;
}

export function createGraphRunCtx(supabase: SupabaseServerClient, tenantId: string, workflowRunId: string): GraphRunCtx {
  return { supabase, tenantId, workflowRunId, agentCache: new Map() };
}

export async function getAgentByCode(ctx: GraphRunCtx, code: string): Promise<AgentRow> {
  const cached = ctx.agentCache.get(code);
  if (cached) return cached;
  const { data, error } = await ctx.supabase
    .from("agents")
    .select("id, code, name, role, provider, model")
    .eq("tenant_id", ctx.tenantId)
    .eq("code", code)
    .single();
  if (error || !data) {
    throw new Error(`Agent with code "${code}" not found for tenant (${error?.message ?? "no rows"})`);
  }
  const agent = data as AgentRow;
  ctx.agentCache.set(code, agent);
  return agent;
}

/**
 * Capability-based agent lookup (spec §2): Phase 4 nodes select an agent by
 * what it can do rather than a single hardcoded code, so the roster's names
 * and headcount stay entirely DB-driven. Falls back to `fallbackCode` (an
 * agent guaranteed to exist, e.g. the shared "sales" coordinator) if no
 * active agent advertises the capability yet — this never throws, since a
 * tenant that hasn't customized its roster should still be able to run the
 * pipeline.
 */
export async function getAgentByCapability(ctx: GraphRunCtx, capability: string, fallbackCode: string): Promise<AgentRow> {
  const cacheKey = `capability:${capability}`;
  const cached = ctx.agentCache.get(cacheKey);
  if (cached) return cached;

  const { data, error } = await ctx.supabase
    .from("agents")
    .select("id, code, name, role, provider, model, capabilities, is_active")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true);
  if (error) throw error;

  const match = (data ?? []).find((a) => {
    const capabilities = (a.capabilities as string[] | null) ?? [];
    return capabilities.includes(capability);
  });

  const agent = (match as AgentRow | undefined) ?? (await getAgentByCode(ctx, fallbackCode));
  ctx.agentCache.set(cacheKey, agent);
  return agent;
}

export async function setAgentStatus(
  ctx: GraphRunCtx,
  agentId: string,
  status: string,
  extra?: { current_project_id?: string | null; current_task_id?: string | null }
): Promise<void> {
  const { error } = await ctx.supabase
    .from("agents")
    .update({ status, ...extra })
    .eq("id", agentId)
    .eq("tenant_id", ctx.tenantId);
  if (error) throw error;
}

export async function emitEvent(
  ctx: GraphRunCtx,
  params: {
    eventType: string;
    fromAgentId?: string | null;
    toAgentId?: string | null;
    message?: string;
    payload?: Record<string, unknown>;
    agentRunId?: string | null;
  }
): Promise<void> {
  const { error } = await ctx.supabase.from("agent_events").insert({
    tenant_id: ctx.tenantId,
    workflow_run_id: ctx.workflowRunId,
    agent_run_id: params.agentRunId ?? null,
    event_type: params.eventType,
    from_agent_id: params.fromAgentId ?? null,
    to_agent_id: params.toAgentId ?? null,
    message: params.message ?? null,
    payload: params.payload ?? {},
  });
  if (error) throw error;
}

/**
 * Runs one agent "step": marks the agent working, records an agent_run,
 * executes `fn`, records completion (or failure), and reverts agent status.
 * Every AI Office status/progress signal traces back to a row written here —
 * nothing in the UI is randomly generated.
 */
export async function runAgentStep<T>(
  ctx: GraphRunCtx,
  params: {
    agentCode: string;
    nodeName: string;
    input: Record<string, unknown>;
    projectId?: string | null;
    taskId?: string | null;
  },
  fn: (agent: AgentRow) => Promise<{ output: Record<string, unknown>; summary: string; result: T }>
): Promise<T> {
  const agent = await getAgentByCode(ctx, params.agentCode);

  await setAgentStatus(ctx, agent.id, "working", {
    current_project_id: params.projectId ?? null,
    current_task_id: params.taskId ?? null,
  });

  const { data: runRow, error: runError } = await ctx.supabase
    .from("agent_runs")
    .insert({
      tenant_id: ctx.tenantId,
      workflow_run_id: ctx.workflowRunId,
      agent_id: agent.id,
      node_name: params.nodeName,
      status: "running",
      input: params.input,
    })
    .select("id")
    .single();
  if (runError || !runRow) throw runError ?? new Error("Failed to create agent_run");
  const agentRunId = runRow.id as string;

  await emitEvent(ctx, {
    eventType: "agent.started",
    toAgentId: agent.id,
    message: `${agent.name}が${params.nodeName}を開始`,
    agentRunId,
  });

  try {
    const { output, summary, result } = await fn(agent);

    await ctx.supabase
      .from("agent_runs")
      .update({ status: "completed", output, completed_at: new Date().toISOString() })
      .eq("id", agentRunId)
      .eq("tenant_id", ctx.tenantId);

    await emitEvent(ctx, {
      eventType: "agent.completed",
      fromAgentId: agent.id,
      message: `${agent.name}: ${summary}`,
      agentRunId,
      payload: output,
    });

    await setAgentStatus(ctx, agent.id, "idle", { current_task_id: null });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.supabase
      .from("agent_runs")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", agentRunId)
      .eq("tenant_id", ctx.tenantId);
    await emitEvent(ctx, {
      eventType: "agent.failed",
      fromAgentId: agent.id,
      message: `${agent.name}: ${message}`,
      agentRunId,
    });
    await setAgentStatus(ctx, agent.id, "failed", { current_task_id: null });
    throw err;
  }
}

export async function recordHandoff(
  ctx: GraphRunCtx,
  params: { fromAgentCode: string; toAgentCode: string; message: string; payload?: Record<string, unknown> }
): Promise<void> {
  const [from, to] = await Promise.all([getAgentByCode(ctx, params.fromAgentCode), getAgentByCode(ctx, params.toAgentCode)]);
  await emitEvent(ctx, {
    eventType: "agent.handoff",
    fromAgentId: from.id,
    toAgentId: to.id,
    message: params.message,
    payload: params.payload,
  });
}

export async function createApprovalRequest(
  ctx: GraphRunCtx,
  params: {
    type: string;
    subjectType: string;
    subjectId: string;
    title: string;
    description?: string;
    riskLevel?: string;
    aiRecommendation?: string;
    requestedByAgentCode?: string;
    /**
     * Manager Approval Queue routing (spec §51-53): an ordered chain of
     * `{role}` steps computed by lib/server/approvalPolicy.ts. Omitted or
     * empty means "no policy routing configured for this call site" — the
     * approval stays on the legacy owner/ceo/admin-decides-directly path
     * (see decideApproval's empty-steps fallback), so every pre-Phase-5 call
     * site keeps working unchanged without passing this at all.
     */
    steps?: ApprovalStep[];
    policyCode?: string | null;
  }
): Promise<string> {
  const requestedByAgent = params.requestedByAgentCode ? await getAgentByCode(ctx, params.requestedByAgentCode) : null;
  const steps = params.steps ?? [];

  const { data, error } = await ctx.supabase
    .from("approval_requests")
    .insert({
      tenant_id: ctx.tenantId,
      type: params.type,
      subject_type: params.subjectType,
      subject_id: params.subjectId,
      title: params.title,
      description: params.description ?? null,
      risk_level: params.riskLevel ?? null,
      ai_recommendation: params.aiRecommendation ?? null,
      requested_by_agent_id: requestedByAgent?.id ?? null,
      status: "pending",
      ...(steps.length > 0 ? { steps, current_step: 0, policy_code: params.policyCode ?? null } : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create approval_request");

  await emitEvent(ctx, {
    eventType: "approval.requested",
    fromAgentId: requestedByAgent?.id ?? null,
    message: `${params.title} の承認を依頼`,
    payload: { approvalRequestId: data.id, type: params.type },
  });

  return data.id as string;
}
