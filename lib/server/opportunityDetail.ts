import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError } from "@/lib/server/errors";

/**
 * Aggregates everything the Opportunity Detail page needs (spec §101):
 * header fields, qualification, Meetings, Proposals + Estimates,
 * Negotiation items (reused from `findings`), Approvals, and Activity.
 */
export async function getOpportunityDetailState(ctx: TenantContext, opportunityId: string) {
  const { supabase, tenantId } = ctx;

  const { data: opportunity, error: oppError } = await supabase.from("opportunities").select("*").eq("id", opportunityId).eq("tenant_id", tenantId).maybeSingle();
  if (oppError) throw oppError;
  if (!opportunity) throw new NotFoundError("Opportunity not found");

  const [leadRes, meetingsRes, proposalsRes, negotiationFindingsRes, oppApprovalsRes, actionItemsRes] = await Promise.all([
    supabase.from("leads").select("id, company_name, industry, region, domain, website").eq("id", opportunity.lead_id as string).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("meetings").select("*").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("created_at", { ascending: false }),
    supabase.from("proposals").select("*").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("created_at", { ascending: false }),
    supabase.from("findings").select("*").eq("tenant_id", tenantId).eq("lead_id", opportunity.lead_id as string).eq("type", "negotiation_item").order("created_at", { ascending: false }),
    supabase.from("approval_requests").select("*").eq("tenant_id", tenantId).eq("subject_type", "opportunity").eq("subject_id", opportunityId).order("created_at", { ascending: false }),
    supabase.from("meeting_action_items").select("*").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("created_at", { ascending: false }),
  ]);
  for (const res of [leadRes, meetingsRes, proposalsRes, negotiationFindingsRes, oppApprovalsRes, actionItemsRes]) {
    if (res.error) throw res.error;
  }

  const proposalIds = (proposalsRes.data ?? []).map((p) => p.id as string);
  let estimates: unknown[] = [];
  let proposalApprovals: unknown[] = [];
  if (proposalIds.length > 0) {
    const [estimatesRes, approvalsRes] = await Promise.all([
      supabase.from("estimates").select("*").eq("tenant_id", tenantId).in("proposal_id", proposalIds).order("created_at", { ascending: false }),
      supabase.from("approval_requests").select("*").eq("tenant_id", tenantId).eq("subject_type", "proposal").in("subject_id", proposalIds).order("created_at", { ascending: false }),
    ]);
    if (estimatesRes.error) throw estimatesRes.error;
    if (approvalsRes.error) throw approvalsRes.error;
    estimates = estimatesRes.data ?? [];
    proposalApprovals = approvalsRes.data ?? [];
  }

  const negotiationItems = (negotiationFindingsRes.data ?? []).filter((f) => (f.payload as { opportunityId?: string })?.opportunityId === opportunityId);

  const approvals = [...(oppApprovalsRes.data ?? []), ...(proposalApprovals as Array<Record<string, unknown>>)];
  const approvalIds = approvals.map((a) => a.id as string);
  let decisionMemories: unknown[] = [];
  if (approvalIds.length > 0) {
    const { data, error } = await supabase.from("decision_memories").select("*").eq("tenant_id", tenantId).in("approval_request_id", approvalIds).order("created_at", { ascending: false });
    if (error) throw error;
    decisionMemories = data ?? [];
  }

  const meetingIds = (meetingsRes.data ?? []).map((m) => m.id as string);
  const subjectIds = [opportunityId, ...proposalIds, ...meetingIds];
  const { data: eventRows, error: eventsError } = await supabase
    .from("agent_events")
    .select("id, event_type, message, payload, from_agent_id, to_agent_id, workflow_run_id, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (eventsError) throw eventsError;
  // agent_events isn't directly subject-scoped, so filter client-side by
  // payload references to this opportunity's ids (best-effort — the
  // canonical trail for any one workflow is still workflow_runs/agent_runs).
  const events = (eventRows ?? []).filter((e) => {
    const payload = e.payload as Record<string, unknown> | null;
    if (!payload) return false;
    return subjectIds.some((id) => Object.values(payload).includes(id));
  });

  return {
    opportunity,
    lead: leadRes.data ?? null,
    meetings: meetingsRes.data ?? [],
    proposals: proposalsRes.data ?? [],
    estimates,
    negotiationItems,
    approvals,
    decisionMemories,
    actionItems: actionItemsRes.data ?? [],
    events,
  };
}

export type OpportunityDetailState = Awaited<ReturnType<typeof getOpportunityDetailState>>;
