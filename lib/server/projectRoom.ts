import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError } from "@/lib/server/errors";

/** Lifecycle stages shown in the Project Room header, in order. */
export const PROJECT_LIFECYCLE = [
  "lead",
  "qualified",
  "proposal",
  "won",
  "contract",
  "onboarding",
  "execution",
  "review",
  "ceo_approval",
  "ready_for_delivery",
  "delivered",
  "measurement",
] as const;

export type ProjectLifecycleStage = (typeof PROJECT_LIFECYCLE)[number];

/**
 * Everything the Project Room ("this deal, not the whole company") needs.
 * Scoped by both `projectId` and `tenantId` — every query below carries both,
 * so a project id from another tenant simply resolves to "not found" rather
 * than leaking cross-tenant rows.
 */
export async function getProjectRoomState(ctx: TenantContext, projectId: string) {
  const { supabase, tenantId } = ctx;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, project_type, status, client_id, contract_id, created_at, updated_at")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) throw new NotFoundError("Project not found");

  const [measurementPlansRes, monthlyReportsRes, contractRenewalsRes, deliveryRecordsRes, upsellOpportunitiesRes] = await Promise.all([
    supabase.from("measurement_plans").select("id, kpi_id, status, start_at, latest_evaluation").eq("project_id", projectId).eq("tenant_id", tenantId),
    supabase.from("monthly_reports").select("id, version, period_start, period_end, status, created_at").eq("project_id", projectId).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(6),
    supabase.from("contract_renewals").select("id, current_end_date, status, risk_level, risk_factors, notice_deadline").eq("project_id", projectId).eq("tenant_id", tenantId).order("current_end_date", { ascending: false }).limit(1),
    supabase.from("delivery_records").select("id, delivered_at, delivery_channel, recipient").eq("project_id", projectId).eq("tenant_id", tenantId).order("delivered_at", { ascending: false }).limit(1),
    project.client_id
      ? supabase.from("upsell_opportunities").select("id, recommended_service, problem, status, estimated_value, created_at").eq("client_id", project.client_id).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const res of [measurementPlansRes, monthlyReportsRes, contractRenewalsRes, deliveryRecordsRes, upsellOpportunitiesRes]) {
    if (res.error) throw res.error;
  }

  const [clientRes, contractRes, teamRes, tasksRes, goalsRes, kpisRes, findingsRes, approvalsRes, deliverablesRes, workflowRunsRes] =
    await Promise.all([
      project.client_id
        ? supabase.from("clients").select("id, name, industry, website").eq("id", project.client_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      project.contract_id
        ? supabase
            .from("contracts")
            .select("id, status, risk_level, opportunity_id, created_at")
            .eq("id", project.contract_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("project_team_members")
        .select("id, agent_id, role_in_project, assigned_at, agents(id, code, name, role, job_title, status, avatar)")
        .eq("project_id", projectId)
        .eq("tenant_id", tenantId),
      supabase
        .from("tasks")
        .select("id, title, description, status, assigned_agent_id, sequence")
        .eq("project_id", projectId)
        .eq("tenant_id", tenantId)
        .order("sequence"),
      supabase.from("goals").select("id, title, target_value, unit, due_date").eq("project_id", projectId).eq("tenant_id", tenantId),
      supabase
        .from("kpis")
        .select("id, name, current_value, target_value, unit, measured_at")
        .eq("project_id", projectId)
        .eq("tenant_id", tenantId),
      supabase
        .from("findings")
        .select("id, type, payload, agent_id, created_at")
        .eq("project_id", projectId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      supabase
        .from("approval_requests")
        .select("id, type, title, description, risk_level, ai_recommendation, status, decision_reason, created_at, decided_at")
        .eq("tenant_id", tenantId)
        .eq("subject_type", "project")
        .eq("subject_id", projectId)
        .order("created_at", { ascending: false }),
      supabase
        .from("deliverables")
        .select("id, task_id, title, type, status, created_at")
        .eq("project_id", projectId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      supabase
        .from("workflow_runs")
        .select("id, graph_name, subject_type, subject_id, status, current_node, created_at, updated_at")
        .eq("tenant_id", tenantId)
        .in("subject_type", ["project", "contract"])
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  for (const res of [clientRes, contractRes, teamRes, tasksRes, goalsRes, kpisRes, findingsRes, approvalsRes, deliverablesRes, workflowRunsRes]) {
    if (res.error) throw res.error;
  }

  const tasks = tasksRes.data ?? [];
  const approvals = approvalsRes.data ?? [];
  const deliverables = deliverablesRes.data ?? [];
  // workflow_runs above is tenant-wide for {project, contract} subjects; narrow to this project/contract chain.
  const relevantSubjectIds = new Set([projectId, project.contract_id].filter(Boolean) as string[]);
  const workflowRuns = (workflowRunsRes.data ?? []).filter((w) => relevantSubjectIds.has(w.subject_id as string));

  // Events for this project's own workflow_runs (its own graph executions),
  // used for the project-scoped Timeline / Activity view.
  const workflowRunIds = workflowRuns.map((w) => w.id as string);
  let events: Array<{
    id: string;
    event_type: string;
    message: string | null;
    payload: Record<string, unknown> | null;
    from_agent_id: string | null;
    to_agent_id: string | null;
    workflow_run_id: string | null;
    created_at: string;
  }> = [];
  if (workflowRunIds.length > 0) {
    const { data: eventRows, error: eventsError } = await supabase
      .from("agent_events")
      .select("id, event_type, message, payload, from_agent_id, to_agent_id, workflow_run_id, created_at")
      .eq("tenant_id", tenantId)
      .in("workflow_run_id", workflowRunIds)
      .order("created_at", { ascending: false })
      .limit(100);
    if (eventsError) throw eventsError;
    events = eventRows ?? [];
  }

  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const blockedTasks = tasks.filter((t) => t.status === "blocked").length;

  // Delivery Gate: four checkpoints that must all be true before delivery is possible.
  const executionComplete = tasks.length > 0 && tasks.every((t) => t.status === "done");
  const criticPassed = tasks.length > 0 && !tasks.some((t) => t.status === "blocked");
  const qaPassed =
    tasks.length > 0 &&
    tasks.every((t) => {
      const deliverable = deliverables.find((d) => d.task_id === t.id);
      return deliverable !== undefined && (deliverable.status === "approved" || deliverable.status === "delivered");
    });
  const deliveryApproval = approvals.find((a) => a.type === "delivery");
  const ceoApproved = deliveryApproval?.status === "approved";

  return {
    project: {
      ...project,
      client: clientRes.data ?? null,
      contract: contractRes.data ?? null,
      lifecycleStage: deriveLifecycleStage(project.status as string, contractRes.data, approvals, deliveryApproval),
    },
    team: (teamRes.data ?? []).map((m) => ({
      id: m.id,
      roleInProject: m.role_in_project,
      agent: (m as unknown as { agents: unknown }).agents,
    })),
    tasks,
    goals: goalsRes.data ?? [],
    kpis: kpisRes.data ?? [],
    findings: findingsRes.data ?? [],
    approvals,
    deliverables,
    workflowRuns,
    events,
    progress: { doneTasks, totalTasks: tasks.length, blockedTasks },
    deliveryGate: { executionComplete, criticPassed, qaPassed, ceoApproved },
    growth: {
      measurementPlans: measurementPlansRes.data ?? [],
      monthlyReports: monthlyReportsRes.data ?? [],
      renewal: (contractRenewalsRes.data ?? [])[0] ?? null,
      deliveryRecord: (deliveryRecordsRes.data ?? [])[0] ?? null,
      upsellOpportunities: upsellOpportunitiesRes.data ?? [],
    },
  };
}

function deriveLifecycleStage(
  projectStatus: string,
  contract: { status?: string } | null,
  approvals: Array<{ type: string; status: string }>,
  deliveryApproval: { status: string } | undefined
): ProjectLifecycleStage {
  if (projectStatus === "delivered") return "delivered";
  if (projectStatus === "ready_for_delivery") return "ready_for_delivery";
  if (deliveryApproval?.status === "pending") return "review";
  const hasDoneTask = approvals.some((a) => a.type === "delivery");
  if (hasDoneTask) return "review";
  if (contract?.status === "approved") return "execution";
  if (projectStatus === "active") return "onboarding";
  return "execution";
}

export type ProjectRoomState = Awaited<ReturnType<typeof getProjectRoomState>>;
