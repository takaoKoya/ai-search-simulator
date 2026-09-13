import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import type { TenantContext } from "@/lib/server/tenant";

export type ApprovalAction = "approve" | "reject" | "revise";

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
 * relevant LangGraph phase; reject/revise always records a decision_memory
 * (the human's stated reason), never silently.
 */
export async function decideApproval(
  ctx: TenantContext,
  approvalId: string,
  action: ApprovalAction,
  reason?: string,
  editNote?: string
): Promise<{ status: string; followUp?: Record<string, unknown> }> {
  const { supabase, tenantId, userId } = ctx;

  if (action !== "approve" && (!reason || reason.trim().length === 0)) {
    throw new ValidationError("Reject / Request Revision には理由の入力が必須です");
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

  const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "revision_requested";
  const eventType =
    action === "approve" ? "approval.approved" : action === "reject" ? "approval.rejected" : "approval.revision_requested";
  const actionLabel = action === "approve" ? "CEOが承認" : action === "reject" ? "CEOが却下" : "CEOが差し戻し";

  const { error: updateError } = await supabase
    .from("approval_requests")
    .update({ status: newStatus, decided_by_user_id: userId, decided_at: new Date().toISOString(), decision_reason: reason ?? null })
    .eq("id", approvalId)
    .eq("tenant_id", tenantId);
  if (updateError) throw updateError;

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: eventType,
    message: `${approvalRow.title}: ${actionLabel}`,
    payload: { approvalRequestId: approvalId, action, type: approvalRow.type },
  });

  if (action !== "approve") {
    await supabase.from("decision_memories").insert({
      tenant_id: tenantId,
      approval_request_id: approvalId,
      category: approvalRow.type,
      note: reason!.trim(),
      created_by_user_id: userId,
    });
    await applyRejection(ctx, approvalRow);
    return { status: newStatus };
  }

  // "Edit and Approve": the CEO's edit note is captured as a decision_memory
  // even though the request is approved as-is (Phase 2 does not yet rewrite
  // the underlying draft content from this note).
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

async function applyRejection(ctx: TenantContext, approval: ApprovalRow): Promise<void> {
  const { supabase, tenantId } = ctx;
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

async function applyApproval(ctx: TenantContext, approval: ApprovalRow): Promise<Record<string, unknown>> {
  const { supabase, tenantId, userId } = ctx;

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
