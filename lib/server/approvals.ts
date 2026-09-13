import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { addToDoNotContact } from "@/lib/sales/dnc";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import type { TenantContext } from "@/lib/server/tenant";

export type ApprovalAction = "approve" | "reject" | "revise" | "hold" | "do_not_contact";

const REASON_REQUIRED_ACTIONS: ApprovalAction[] = ["reject", "revise", "do_not_contact"];
/** hold/do_not_contact are §27-28 CEO decisions specific to sales_lead approvals. */
const SALES_LEAD_ONLY_ACTIONS: ApprovalAction[] = ["hold", "do_not_contact"];

const STATUS_BY_ACTION: Record<ApprovalAction, string> = {
  approve: "approved",
  reject: "rejected",
  revise: "revision_requested",
  hold: "hold",
  do_not_contact: "do_not_contact",
};

const EVENT_TYPE_BY_ACTION: Record<ApprovalAction, string> = {
  approve: "approval.approved",
  reject: "approval.rejected",
  revise: "approval.revision_requested",
  hold: "approval.hold",
  do_not_contact: "approval.do_not_contact",
};

const ACTION_LABEL: Record<ApprovalAction, string> = {
  approve: "CEOが承認",
  reject: "CEOが却下",
  revise: "CEOが差し戻し",
  hold: "CEOが保留",
  do_not_contact: "CEOが「今後営業しない」を選択",
};

interface ApprovalRow {
  id: string;
  tenant_id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  title: string;
  status: string;
}

/**
 * The single decision path for every approval_requests row, regardless of
 * domain (sales/contract/delivery) — per the product brief, one shared
 * approval mechanism, not separate systems per domain. Approve continues the
 * relevant LangGraph phase; reject/revise/do_not_contact always record a
 * decision_memory (the human's stated reason), never silently.
 */
export async function decideApproval(
  ctx: TenantContext,
  approvalId: string,
  action: ApprovalAction,
  reason?: string,
  editNote?: string
): Promise<{ status: string; followUp?: Record<string, unknown> }> {
  const { supabase, tenantId, userId } = ctx;

  if (REASON_REQUIRED_ACTIONS.includes(action) && (!reason || reason.trim().length === 0)) {
    throw new ValidationError("Reject / Request Revision / Do Not Contact には理由の入力が必須です");
  }

  const { data: approval, error } = await supabase
    .from("approval_requests")
    .select("id, tenant_id, type, subject_type, subject_id, title, status")
    .eq("id", approvalId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !approval) throw new NotFoundError("Approval request not found");
  const approvalRow = approval as ApprovalRow;
  if (approvalRow.status !== "pending") {
    throw new ValidationError(`This approval was already decided (status=${approvalRow.status})`);
  }
  if (SALES_LEAD_ONLY_ACTIONS.includes(action) && approvalRow.type !== "sales_lead") {
    throw new ValidationError(`"${action}" is only valid for sales_lead approvals`);
  }

  const newStatus = STATUS_BY_ACTION[action];

  const { error: updateError } = await supabase
    .from("approval_requests")
    .update({ status: newStatus, decided_by_user_id: userId, decided_at: new Date().toISOString(), decision_reason: reason ?? null })
    .eq("id", approvalId)
    .eq("tenant_id", tenantId);
  if (updateError) throw updateError;

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: EVENT_TYPE_BY_ACTION[action],
    message: `${approvalRow.title}: ${ACTION_LABEL[action]}`,
    payload: { approvalRequestId: approvalId, action, type: approvalRow.type },
  });

  if (action !== "approve") {
    const { data: memoryRow, error: memoryError } = await supabase
      .from("decision_memories")
      .insert({
        tenant_id: tenantId,
        approval_request_id: approvalId,
        category: approvalRow.type,
        note: reason && reason.trim().length > 0 ? reason.trim() : `${ACTION_LABEL[action]}（理由未記入）`,
        created_by_user_id: userId,
      })
      .select("id")
      .single();
    if (memoryError) throw memoryError;

    await applyNonApproval(ctx, approvalRow, action, reason);

    if ((action === "reject" || action === "do_not_contact") && approvalRow.type === "sales_lead" && memoryRow) {
      await maybeFlagRuleCandidate(ctx, approvalRow, memoryRow.id as string);
    }
    return { status: newStatus };
  }

  // "Edit and Approve": the CEO's edit note is captured as a decision_memory
  // even though the request is approved as-is (content is not auto-rewritten
  // from this note yet).
  if (editNote && editNote.trim().length > 0) {
    await supabase.from("decision_memories").insert({
      tenant_id: tenantId,
      approval_request_id: approvalId,
      category: `${approvalRow.type}_edit`,
      note: editNote.trim(),
      created_by_user_id: userId,
    });
  }

  const followUp = await applyApproval(ctx, approvalRow);
  return { status: newStatus, followUp };
}

async function applyNonApproval(ctx: TenantContext, approval: ApprovalRow, action: ApprovalAction, reason?: string): Promise<void> {
  const { supabase, tenantId } = ctx;

  if (approval.type === "sales_lead") {
    const discoveryStage = action === "reject" ? "REJECTED" : action === "hold" ? "ON_HOLD" : action === "do_not_contact" ? "BLOCKED" : null;
    if (discoveryStage) {
      await supabase.from("leads").update({ discovery_stage: discoveryStage }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    }
    if (action === "do_not_contact") {
      const { data: lead } = await supabase.from("leads").select("company_name, domain").eq("id", approval.subject_id).eq("tenant_id", tenantId).maybeSingle();
      if (lead) {
        await addToDoNotContact(supabase, tenantId, {
          companyName: lead.company_name as string,
          domain: lead.domain as string | null,
          reason: reason ?? "CEOが今後営業しないと判断",
          createdByUserId: ctx.userId,
        });
      }
    }
    return;
  }

  if (approval.type === "sales_outreach") {
    await supabase.from("opportunities").update({ status: "lost" }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    const { data: opp } = await supabase.from("opportunities").select("lead_id").eq("id", approval.subject_id).maybeSingle();
    if (opp) {
      await supabase.from("leads").update({ status: "rejected" }).eq("id", opp.lead_id as string).eq("tenant_id", tenantId);
    }
  } else if (approval.type === "contract_approval") {
    await supabase.from("contracts").update({ status: "rejected" }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
  }
  // "delivery" rejection: leave the project active for rework; no automated action beyond the decision_memory.
}

/**
 * Decision Learning (spec §30): scans this tenant's recent sales_lead
 * reject/do_not_contact decisions for a repeated industry pattern. Never
 * changes targeting rules itself — only flags the most recent matching
 * decision_memory as a rule_candidate for a human to act on.
 */
async function maybeFlagRuleCandidate(ctx: TenantContext, approval: ApprovalRow, decisionMemoryId: string): Promise<void> {
  const { supabase, tenantId } = ctx;
  const RULE_CANDIDATE_THRESHOLD = 3;
  const LOOKBACK = 30;

  const { data: currentLead } = await supabase.from("leads").select("industry").eq("id", approval.subject_id).eq("tenant_id", tenantId).maybeSingle();
  const industry = currentLead?.industry as string | null | undefined;
  if (!industry) return;

  const { data: recentDecisions } = await supabase
    .from("decision_memories")
    .select("id, approval_request_id")
    .eq("tenant_id", tenantId)
    .eq("category", "sales_lead")
    .order("created_at", { ascending: false })
    .limit(LOOKBACK);
  if (!recentDecisions || recentDecisions.length === 0) return;

  const approvalIds = recentDecisions.map((d) => d.approval_request_id).filter((id): id is string => Boolean(id));
  if (approvalIds.length === 0) return;

  const { data: relatedApprovals } = await supabase.from("approval_requests").select("id, subject_id").in("id", approvalIds).eq("tenant_id", tenantId);
  const leadIdByApprovalId = new Map((relatedApprovals ?? []).map((a) => [a.id as string, a.subject_id as string]));
  const leadIds = Array.from(new Set(leadIdByApprovalId.values()));
  if (leadIds.length === 0) return;

  const { data: relatedLeads } = await supabase.from("leads").select("id, industry").in("id", leadIds).eq("tenant_id", tenantId);
  const industryByLeadId = new Map((relatedLeads ?? []).map((l) => [l.id as string, l.industry as string | null]));

  const matchingCount = recentDecisions.filter((d) => {
    const leadId = d.approval_request_id ? leadIdByApprovalId.get(d.approval_request_id as string) : undefined;
    return leadId && industryByLeadId.get(leadId) === industry;
  }).length;

  if (matchingCount >= RULE_CANDIDATE_THRESHOLD) {
    await supabase.from("decision_memories").update({ rule_candidate: true }).eq("id", decisionMemoryId).eq("tenant_id", tenantId);
    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "decision.rule_candidate_detected",
      message: `直近${LOOKBACK}件中${matchingCount}件が「${industry}」業種の却下/DNC。除外条件への追加を検討してください。`,
      payload: { industry, matchingCount, lookback: LOOKBACK },
    });
  }
}

async function applyApproval(ctx: TenantContext, approval: ApprovalRow): Promise<Record<string, unknown>> {
  const { supabase, tenantId, userId } = ctx;

  if (approval.type === "sales_lead") {
    await supabase
      .from("leads")
      .update({ discovery_stage: "READY_FOR_OUTREACH", status: "approved" })
      .eq("id", approval.subject_id)
      .eq("tenant_id", tenantId);

    const draftResult = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "sales_draft_graph",
      subjectType: "lead",
      subjectId: approval.subject_id,
      input: { leadId: approval.subject_id },
    });
    return { draft: draftResult };
  }

  if (approval.type === "sales_outreach") {
    const { data: opp, error } = await supabase
      .from("opportunities")
      .select("id, lead_id, amount")
      .eq("id", approval.subject_id)
      .single();
    if (error || !opp) throw error ?? new Error("Opportunity not found");

    const salesResult = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "sales_graph",
      subjectType: "opportunity",
      subjectId: opp.id as string,
      input: { opportunityId: opp.id, leadId: opp.lead_id },
    });

    if (salesResult.status !== "completed") return { sales: salesResult };

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("company_name, industry")
      .eq("id", opp.lead_id as string)
      .single();
    if (leadError || !lead) throw leadError ?? new Error("Lead not found");

    const contractResult = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "contract_graph",
      subjectType: "opportunity",
      subjectId: opp.id as string,
      input: { opportunityId: opp.id, companyName: lead.company_name, amount: opp.amount },
    });

    return { sales: salesResult, contract: contractResult };
  }

  if (approval.type === "contract_approval") {
    await supabase
      .from("contracts")
      .update({ status: "approved", approved_by_user_id: userId })
      .eq("id", approval.subject_id)
      .eq("tenant_id", tenantId);

    const { data: contract, error } = await supabase
      .from("contracts")
      .select("id, opportunity_id")
      .eq("id", approval.subject_id)
      .single();
    if (error || !contract) throw error ?? new Error("Contract not found");

    const { data: opp, error: oppError } = await supabase
      .from("opportunities")
      .select("lead_id")
      .eq("id", contract.opportunity_id as string)
      .single();
    if (oppError || !opp) throw oppError ?? new Error("Opportunity not found");

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("company_name, industry")
      .eq("id", opp.lead_id as string)
      .single();
    if (leadError || !lead) throw leadError ?? new Error("Lead not found");

    const onboardingResult = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "onboarding_graph",
      subjectType: "contract",
      subjectId: contract.id as string,
      input: { contractId: contract.id, companyName: lead.company_name, industry: lead.industry },
    });

    return { onboarding: onboardingResult };
  }

  if (approval.type === "delivery") {
    const deliveryResult = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "delivery_graph",
      subjectType: "project",
      subjectId: approval.subject_id,
      input: { projectId: approval.subject_id },
    });
    return { delivery: deliveryResult };
  }

  throw new ValidationError(`Unknown approval type: ${approval.type}`);
}
