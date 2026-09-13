import type { TenantContext } from "@/lib/server/tenant";

/**
 * Everything the AI Office UI renders, aggregated in one place. Every field
 * here traces back to a DB row written by real agent/workflow/approval
 * activity — nothing is synthesized for display.
 */
export async function getOfficeState(ctx: TenantContext) {
  const { supabase, tenantId } = ctx;

  const [departmentsRes, agentsRes, assignmentsRes, approvalsRes, eventsRes, workflowRunsRes, projectsRes, tasksRes, leadsRes] =
    await Promise.all([
      supabase.from("departments").select("id, code, name, sort_order").eq("tenant_id", tenantId).order("sort_order"),
      supabase
        .from("agents")
        .select("id, code, name, role, job_title, status, avatar, current_project_id, current_task_id, is_active")
        .eq("tenant_id", tenantId)
        .order("code"),
      supabase.from("agent_department_assignments").select("agent_id, department_id").eq("tenant_id", tenantId),
      supabase
        .from("approval_requests")
        .select("id, type, subject_type, subject_id, title, description, risk_level, ai_recommendation, status, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("agent_events")
        .select("id, event_type, message, payload, from_agent_id, to_agent_id, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("workflow_runs")
        .select("id, graph_name, subject_type, subject_id, status, current_node, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("projects")
        .select("id, name, project_type, status, client_id, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
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
    ]);

  for (const res of [departmentsRes, agentsRes, assignmentsRes, approvalsRes, eventsRes, workflowRunsRes, projectsRes, tasksRes, leadsRes]) {
    if (res.error) throw res.error;
  }

  const departments = departmentsRes.data ?? [];
  const agents = agentsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const approvals = approvalsRes.data ?? [];
  const events = eventsRes.data ?? [];
  const workflowRuns = workflowRunsRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const leads = leadsRes.data ?? [];

  const agentIdToName = new Map(agents.map((a) => [a.id as string, a.name as string]));
  const eventsWithNames = events.map((e) => ({
    ...e,
    fromAgentName: e.from_agent_id ? (agentIdToName.get(e.from_agent_id as string) ?? null) : null,
    toAgentName: e.to_agent_id ? (agentIdToName.get(e.to_agent_id as string) ?? null) : null,
  }));

  const departmentsWithAgents = departments.map((dept) => ({
    ...dept,
    agents: assignments
      .filter((a) => a.department_id === dept.id)
      .map((a) => agents.find((agent) => agent.id === a.agent_id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a)),
  }));
  const unassignedAgents = agents.filter((agent) => !assignments.some((a) => a.agent_id === agent.id));

  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const projectProgress = projects.map((project) => {
    const projectTasks = tasks.filter((t) => t.project_id === project.id);
    const done = projectTasks.filter((t) => t.status === "done").length;
    return { ...project, totalTasks: projectTasks.length, doneTasks: done };
  });

  return {
    departments: departmentsWithAgents,
    unassignedAgents,
    agents,
    approvals,
    pendingApprovals,
    events: eventsWithNames,
    workflowRuns,
    projects: projectProgress,
    tasks,
    leads,
  };
}

export type OfficeState = Awaited<ReturnType<typeof getOfficeState>>;
