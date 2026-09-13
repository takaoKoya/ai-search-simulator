import type { TenantContext } from "@/lib/server/tenant";

/**
 * Everything the AI Office UI renders, aggregated in one place. Every field
 * here traces back to a DB row written by real agent/workflow/approval
 * activity — nothing is synthesized for display. Where a UI element wants a
 * number that has no direct column (e.g. "today's approvals will take about
 * N minutes"), it is computed from real historical rows (see
 * `estimateCeoMinutes`), never a placeholder constant.
 */
export async function getOfficeState(ctx: TenantContext) {
  const { supabase, tenantId } = ctx;

  const [
    departmentsRes,
    agentsRes,
    assignmentsRes,
    approvalsRes,
    decidedApprovalsRes,
    eventsRes,
    workflowRunsRes,
    projectsRes,
    clientsRes,
    tasksRes,
    leadsRes,
    opportunitiesRes,
    contractsRes,
  ] = await Promise.all([
    supabase.from("departments").select("id, code, name, sort_order").eq("tenant_id", tenantId).order("sort_order"),
    supabase
      .from("agents")
      .select("id, code, name, role, job_title, status, avatar, current_project_id, current_task_id, is_active")
      .eq("tenant_id", tenantId)
      .order("code"),
    supabase.from("agent_department_assignments").select("agent_id, department_id").eq("tenant_id", tenantId),
    supabase
      .from("approval_requests")
      .select(
        "id, type, subject_type, subject_id, title, description, risk_level, ai_recommendation, status, requested_by_agent_id, created_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("approval_requests")
      .select("created_at, decided_at")
      .eq("tenant_id", tenantId)
      .not("decided_at", "is", null)
      .order("decided_at", { ascending: false })
      .limit(20),
    supabase
      .from("agent_events")
      .select("id, event_type, message, payload, from_agent_id, to_agent_id, workflow_run_id, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("workflow_runs")
      .select("id, graph_name, subject_type, subject_id, status, current_node, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("projects")
      .select("id, name, project_type, status, client_id, contract_id, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("tenant_id", tenantId),
    supabase
      .from("tasks")
      .select("id, project_id, title, status, assigned_agent_id, sequence")
      .eq("tenant_id", tenantId)
      .order("sequence"),
    supabase
      .from("leads")
      .select("id, company_name, industry, status, score, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase.from("opportunities").select("id, lead_id, amount, currency").eq("tenant_id", tenantId),
    supabase.from("contracts").select("id, opportunity_id").eq("tenant_id", tenantId),
  ]);

  for (const res of [
    departmentsRes,
    agentsRes,
    assignmentsRes,
    approvalsRes,
    decidedApprovalsRes,
    eventsRes,
    workflowRunsRes,
    projectsRes,
    clientsRes,
    tasksRes,
    leadsRes,
    opportunitiesRes,
    contractsRes,
  ]) {
    if (res.error) throw res.error;
  }

  const departments = departmentsRes.data ?? [];
  const agents = agentsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const rawApprovals = approvalsRes.data ?? [];
  const decidedApprovals = decidedApprovalsRes.data ?? [];
  const events = eventsRes.data ?? [];
  const workflowRuns = workflowRunsRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const clients = clientsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const leads = leadsRes.data ?? [];
  const opportunities = opportunitiesRes.data ?? [];
  const contracts = contractsRes.data ?? [];

  const agentIdToName = new Map(agents.map((a) => [a.id as string, a.name as string]));
  const clientNameById = new Map(clients.map((c) => [c.id as string, c.name as string]));
  const eventsWithNames = events.map((e) => ({
    ...e,
    fromAgentName: e.from_agent_id ? (agentIdToName.get(e.from_agent_id as string) ?? null) : null,
    toAgentName: e.to_agent_id ? (agentIdToName.get(e.to_agent_id as string) ?? null) : null,
  }));

  // Recent failure/rejection signals per agent double as a real (not
  // fabricated) "notification count" on its card — capped to a short lookback
  // so a card doesn't carry a stale badge forever.
  const NOTIFICATION_EVENT_TYPES = new Set(["agent.failed", "critic.rejected", "qa.failed"]);
  const notificationCountByAgent = new Map<string, number>();
  for (const e of events) {
    if (!NOTIFICATION_EVENT_TYPES.has(e.event_type as string)) continue;
    for (const agentId of [e.from_agent_id, e.to_agent_id]) {
      if (!agentId) continue;
      notificationCountByAgent.set(agentId as string, (notificationCountByAgent.get(agentId as string) ?? 0) + 1);
    }
  }

  const enrichedAgents = agents.map((a) => ({ ...a, notificationCount: notificationCountByAgent.get(a.id as string) ?? 0 }));

  // Resolve each approval's real-world subject (company / project name,
  // deal amount) and an urgency tier derived from risk + how long it has sat
  // pending — both are read from actual rows, not invented for display.
  const leadNameByOpportunityId = new Map(
    opportunities.map((o) => [o.id as string, leads.find((l) => l.id === o.lead_id)?.company_name ?? null])
  );
  const opportunityIdByContractId = new Map(contracts.map((c) => [c.id as string, c.opportunity_id as string]));
  const projectNameBySubjectId = new Map(projects.map((p) => [p.id as string, p.name as string]));

  const approvals = rawApprovals.map((a) => {
    let subjectLabel: string | null = null;
    let amount: number | null = null;
    if (a.type === "sales_outreach") {
      subjectLabel = leadNameByOpportunityId.get(a.subject_id as string) ?? null;
      amount = (opportunities.find((o) => o.id === a.subject_id)?.amount as number | undefined) ?? null;
    } else if (a.type === "contract_approval") {
      const oppId = opportunityIdByContractId.get(a.subject_id as string);
      subjectLabel = oppId ? (leadNameByOpportunityId.get(oppId) ?? null) : null;
      amount = oppId ? ((opportunities.find((o) => o.id === oppId)?.amount as number | undefined) ?? null) : null;
    } else if (a.type === "delivery") {
      subjectLabel = projectNameBySubjectId.get(a.subject_id as string) ?? null;
    }

    const ageHours = (Date.now() - new Date(a.created_at as string).getTime()) / 3_600_000;
    const risk = a.risk_level as string | null;
    let urgency: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
    if (risk === "CRITICAL") urgency = "CRITICAL";
    else if (risk === "HIGH" || ageHours > 48) urgency = "HIGH";
    else if (risk === "MEDIUM" || ageHours > 8) urgency = "NORMAL";
    else urgency = "LOW";

    return { ...a, subjectLabel, amount, urgency };
  });

  const agentToDepartmentId = new Map(assignments.map((a) => [a.agent_id as string, a.department_id as string]));
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const blockedTaskAgentIds = new Set(
    tasks.filter((t) => t.status === "blocked" && t.assigned_agent_id).map((t) => t.assigned_agent_id as string)
  );

  const projectProgress = projects.map((project) => {
    const projectTasks = tasks.filter((t) => t.project_id === project.id);
    const done = projectTasks.filter((t) => t.status === "done").length;
    return {
      ...project,
      clientName: project.client_id ? (clientNameById.get(project.client_id as string) ?? null) : null,
      totalTasks: projectTasks.length,
      doneTasks: done,
    };
  });
  const departmentsWithAgents = departments.map((dept) => {
    const deptAgents = assignments
      .filter((a) => a.department_id === dept.id)
      .map((a) => enrichedAgents.find((agent) => agent.id === a.agent_id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a));

    const activeCount = deptAgents.filter((a) => a.status !== "idle" && a.status !== "completed").length;
    const projectIds = new Set<string>();
    for (const a of deptAgents) if (a.current_project_id) projectIds.add(a.current_project_id as string);
    const pendingApprovalCount = pendingApprovals.filter((appr) => {
      const agentId = appr.requested_by_agent_id as string | null;
      return agentId && agentToDepartmentId.get(agentId) === dept.id;
    }).length;
    const warningCount =
      deptAgents.filter((a) => a.status === "warning" || a.status === "failed").length +
      deptAgents.filter((a) => blockedTaskAgentIds.has(a.id as string)).length;

    return {
      ...dept,
      agents: deptAgents,
      stats: {
        activeCount,
        totalCount: deptAgents.length,
        activeProjectCount: projectIds.size,
        pendingApprovalCount,
        warningCount,
      },
    };
  });
  const unassignedAgents = enrichedAgents.filter((agent) => !assignments.some((a) => a.agent_id === agent.id));

  return {
    departments: departmentsWithAgents,
    unassignedAgents,
    agents: enrichedAgents,
    approvals,
    pendingApprovals,
    events: eventsWithNames,
    workflowRuns,
    projects: projectProgress,
    tasks,
    leads,
    ceoSummary: buildCeoSummary(pendingApprovals, decidedApprovals),
  };
}

const APPROVAL_TYPE_LABEL: Record<string, string> = {
  sales_outreach: "営業承認",
  contract_approval: "契約承認",
  delivery: "納品承認",
};

function buildCeoSummary(
  pendingApprovals: Array<{ type: string }>,
  decidedApprovals: Array<{ created_at: string; decided_at: string | null }>
) {
  const byType: Record<string, number> = {};
  for (const a of pendingApprovals) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
  }

  // Real average handling time from this tenant's own decision history
  // (created_at -> decided_at), not a guessed constant. Falls back to
  // "indeterminate" (null) when there is no history yet.
  const durationsMinutes = decidedApprovals
    .filter((a) => a.decided_at)
    .map((a) => (new Date(a.decided_at as string).getTime() - new Date(a.created_at).getTime()) / 60000)
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0 && minutes < 24 * 60); // discard multi-day outliers

  const avgMinutesPerApproval =
    durationsMinutes.length > 0 ? durationsMinutes.reduce((sum, m) => sum + m, 0) / durationsMinutes.length : null;

  const estimatedMinutesToday =
    avgMinutesPerApproval !== null ? Math.round(avgMinutesPerApproval * pendingApprovals.length) : null;

  return {
    byType: Object.entries(byType).map(([type, count]) => ({ type, label: APPROVAL_TYPE_LABEL[type] ?? type, count })),
    totalPending: pendingApprovals.length,
    estimatedMinutesToday,
  };
}

export type OfficeState = Awaited<ReturnType<typeof getOfficeState>>;
