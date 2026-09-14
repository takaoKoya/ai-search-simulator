import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError } from "@/lib/server/errors";

/**
 * Aggregates everything the Lead Detail page's 9 tabs need (spec §32-36):
 * Overview / Research / Website Analysis / Score / Sales Strategy / Evidence
 * / Activity / Approvals / History.
 *
 * A lead doesn't exist yet when `lead_discovery_graph` starts (its
 * workflow_runs.subject_id is the icp_profile_id until the candidate is
 * inserted), so workflow runs are looked up two ways: directly by
 * subject_type='lead' (covers sales_draft_graph, which starts after the
 * lead exists) OR by subject_type='icp_profile' with a JSONB path filter on
 * the saved state's leadId (covers lead_discovery_graph itself).
 */
export async function getLeadDetailState(ctx: TenantContext, leadId: string) {
  const { supabase, tenantId } = ctx;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead) throw new NotFoundError("Lead not found");

  const [scoresRes, hypothesesRes, findingsRes, draftsRes, approvalsRes, byLeadRunsRes, byIcpRunsRes, conversationsRes, messagesRes, opportunitiesRes] = await Promise.all([
    supabase.from("lead_scores").select("*").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }),
    supabase
      .from("lead_sales_hypotheses")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase.from("findings").select("*").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }),
    supabase.from("sales_drafts").select("*").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }),
    supabase
      .from("approval_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("subject_type", "lead")
      .eq("subject_id", leadId)
      .order("created_at", { ascending: false }),
    supabase.from("workflow_runs").select("*").eq("tenant_id", tenantId).eq("subject_type", "lead").eq("subject_id", leadId),
    supabase
      .from("workflow_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("subject_type", "icp_profile")
      .filter("state->>leadId", "eq", leadId),
    supabase.from("sales_conversations").select("*").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }),
    supabase.from("sales_messages").select("*").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: true }),
    supabase.from("opportunities").select("id, stage, status").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }),
  ]);
  for (const res of [scoresRes, hypothesesRes, findingsRes, draftsRes, approvalsRes, byLeadRunsRes, byIcpRunsRes, conversationsRes, messagesRes, opportunitiesRes]) {
    if (res.error) throw res.error;
  }

  const messageIds = (messagesRes.data ?? []).map((m) => m.id as string);
  let messageApprovals: unknown[] = [];
  if (messageIds.length > 0) {
    const { data, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("subject_type", "sales_message")
      .in("subject_id", messageIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    messageApprovals = data ?? [];
  }

  const workflowRuns = [...(byLeadRunsRes.data ?? []), ...(byIcpRunsRes.data ?? [])];
  const workflowRunIds = workflowRuns.map((w) => w.id as string);

  let events: unknown[] = [];
  if (workflowRunIds.length > 0) {
    const { data: eventRows, error: eventsError } = await supabase
      .from("agent_events")
      .select("id, event_type, message, payload, from_agent_id, to_agent_id, workflow_run_id, created_at")
      .eq("tenant_id", tenantId)
      .in("workflow_run_id", workflowRunIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (eventsError) throw eventsError;
    events = eventRows ?? [];
  }

  const approvals = [...(approvalsRes.data ?? []), ...(messageApprovals as Array<Record<string, unknown>>)];
  const approvalIds = approvals.map((a) => a.id as string);
  let decisionMemories: unknown[] = [];
  if (approvalIds.length > 0) {
    const { data, error } = await supabase
      .from("decision_memories")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("approval_request_id", approvalIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    decisionMemories = data ?? [];
  }

  return {
    lead,
    scores: scoresRes.data ?? [],
    latestScore: (scoresRes.data ?? [])[0] ?? null,
    hypotheses: hypothesesRes.data ?? [],
    latestHypothesis: (hypothesesRes.data ?? [])[0] ?? null,
    findings: findingsRes.data ?? [],
    drafts: draftsRes.data ?? [],
    approvals,
    decisionMemories,
    workflowRuns,
    events,
    conversations: conversationsRes.data ?? [],
    messages: messagesRes.data ?? [],
    opportunities: opportunitiesRes.data ?? [],
  };
}

export type LeadDetailState = Awaited<ReturnType<typeof getLeadDetailState>>;
