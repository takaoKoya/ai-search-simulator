import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { addToDoNotContact } from "@/lib/sales/dnc";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/server/errors";
import type { TenantContext } from "@/lib/server/tenant";
import type { ApprovalStep } from "@/lib/server/approvalPolicy";
import { computeCooldownUntil } from "@/lib/server/upsell";
import { transitionWork } from "@/lib/autonomy/stateTransition";
import { writeDecisionLog } from "@/lib/autonomy/decisionLog";

import { getEmailConnector } from "@/lib/sales/emailConnector";

/**
 * Roles that can decide (or override) any approval regardless of its step
 * chain — the pre-Phase-5 CEO Inbox semantics, unchanged. A "manager" role
 * can only decide the specific step assigned to it by `steps`.
 */
const SUPERUSER_ROLES: TenantContext["role"][] = ["owner", "ceo", "admin"];

export type ApprovalAction = "approve" | "reject" | "revise" | "hold" | "do_not_contact";

const REASON_REQUIRED_ACTIONS: ApprovalAction[] = ["reject", "revise", "do_not_contact"];
/**
 * hold/do_not_contact are CEO decisions specific to sales-domain approvals
 * (spec §27-28 for sales_lead, §10 for sales_send/sales_reply — the CEO can
 * always park or blacklist a company at any point in the sales pipeline).
 */
const HOLD_DNC_ALLOWED_TYPES = ["sales_lead", "sales_send", "sales_reply", "proposal_approval", "deal_won", "upsell_opportunity"];

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
  steps?: ApprovalStep[] | null;
  current_step?: number | null;
  policy_code?: string | null;
  cycle_id?: string | null;
}

/**
 * Whether ANY policy named by this approval's (possibly comma-joined,
 * spec §51-53) `policy_code` is a Hard DENY policy (AI Company OS PHASE 1
 * FINAL CHANGE 3). AuthorityEngine itself never creates an approval_requests
 * row for a hard_deny match (there is nothing to ask a human about) — this
 * exists purely as defense in depth for any approval type, present or
 * future, whose policy is later flagged hard_deny.
 */
async function isHardDenyPolicyMatch(ctx: TenantContext, policyCode: string | null | undefined): Promise<boolean> {
  if (!policyCode) return false;
  const codes = policyCode
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (codes.length === 0) return false;

  const { data, error } = await ctx.supabase.from("approval_policies").select("hard_deny").eq("tenant_id", ctx.tenantId).in("code", codes);
  if (error) throw error;
  return (data ?? []).some((row) => row.hard_deny === true);
}

/**
 * Fine-grained step authorization (spec §51-53), extended by AI Company OS
 * PHASE 1 FINAL CHANGE 3 (Hard DENY): a hard_deny policy match on "approve"
 * throws unconditionally, evaluated BEFORE the superuser check below — the
 * owner/ceo/admin bypass is never even consulted for it, not merely
 * overridden by an added condition. There is no code path, including a
 * superuser API call, that can turn a hard-denied decision into an approval.
 *
 * Below that: owner/ceo/admin can always decide/override any (non-hard-deny)
 * approval at any step — identical to every pre-Phase-5 approval type, which
 * never had a `steps` chain at all (empty steps here falls back to
 * "superuser only", exactly matching the route-level
 * `assertRole(ctx, APPROVER_ROLES)` gate that guarded every approval type
 * before this phase). A non-superuser role (e.g. "manager") may only decide
 * when it is explicitly named at the chain's current step.
 */
function authorizeDecision(ctx: TenantContext, steps: ApprovalStep[], currentStep: number, action: ApprovalAction, hardDeny: boolean): void {
  if (hardDeny && action === "approve") {
    throw new ForbiddenError("This approval is Hard DENY per policy — no role, including owner/ceo/admin, may approve it.");
  }
  if (SUPERUSER_ROLES.includes(ctx.role)) return;
  const step = steps[currentStep];
  if (!step || step.role !== ctx.role) {
    throw new ForbiddenError(`Role "${ctx.role}" cannot decide this approval${step ? ` (requires "${step.role}")` : ""}`);
  }
}

/** Every human Approve/Reject on an autonomy Work must be logged (spec FINAL CHANGE 5) — distinguishable from AuthorityEngine's own SYSTEM-actor AUTHORIZE decision on the same work. Only ever called for `type==='work_creation'`, whose approval_requests row always carries a cycle_id (set by createAndAuthorizeWork). */
async function writeWorkHumanInterventionLog(ctx: TenantContext, params: { cycleId: string; workId: string; action: "APPROVE" | "REJECT"; reason?: string }): Promise<void> {
  await writeDecisionLog(ctx.supabase, ctx.tenantId, {
    cycleId: params.cycleId,
    workId: params.workId,
    stage: "HUMAN_INTERVENTION",
    actorType: "HUMAN",
    actorId: ctx.userId,
    action: params.action,
    reasoningSummary: params.reason ?? null,
  });
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
    .select("id, tenant_id, type, subject_type, subject_id, title, status, steps, current_step, policy_code, cycle_id")
    .eq("id", approvalId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !approval) throw new NotFoundError("Approval request not found");
  const approvalRow = approval as ApprovalRow;
  if (approvalRow.status !== "pending") {
    throw new ValidationError(`This approval was already decided (status=${approvalRow.status})`);
  }
  if ((action === "hold" || action === "do_not_contact") && !HOLD_DNC_ALLOWED_TYPES.includes(approvalRow.type)) {
    throw new ValidationError(`"${action}" is not valid for ${approvalRow.type} approvals`);
  }

  const steps = approvalRow.steps ?? [];
  const currentStep = approvalRow.current_step ?? 0;
  const hardDeny = await isHardDenyPolicyMatch(ctx, approvalRow.policy_code);
  authorizeDecision(ctx, steps, currentStep, action, hardDeny);

  if (action === "approve" && editNote && editNote.trim().length > 0) {
    await supabase.from("decision_memories").insert({
      tenant_id: tenantId,
      approval_request_id: approvalId,
      category: `${approvalRow.type}_edit`,
      note: editNote.trim(),
      created_by_user_id: userId,
    });
  }

  // Manager Approval Queue (spec §51-53): approving a non-final step in a
  // multi-step chain advances the chain instead of finalizing the approval —
  // only approving the LAST step runs applyApproval()'s side effects. A
  // chain with no steps (every pre-Phase-5 approval type) never enters here.
  if (action === "approve" && steps.length > 0 && currentStep < steps.length - 1) {
    const nextStep = currentStep + 1;
    const advancedSteps = steps.map((s, i) => (i === currentStep ? { ...s, status: "APPROVED", approver_user_id: userId, decided_at: new Date().toISOString() } : s));
    await supabase.from("approval_requests").update({ steps: advancedSteps, current_step: nextStep }).eq("id", approvalId).eq("tenant_id", tenantId);
    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "approval.step_approved",
      message: `${approvalRow.title}: ${ctx.role}が承認（次の承認者: ${steps[nextStep]?.role}）`,
      payload: { approvalRequestId: approvalId, action, type: approvalRow.type, step: currentStep, nextRole: steps[nextStep]?.role },
    });
    return { status: "pending" };
  }

  const newStatus = STATUS_BY_ACTION[action];

  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    decided_by_user_id: userId,
    decided_at: new Date().toISOString(),
    decision_reason: reason ?? null,
  };
  if (steps.length > 0) {
    // Finalize the chain: the deciding step is marked APPROVED/REJECTED
    // (whichever ended the chain), any earlier step keeps its already-
    // recorded decision, and any not-yet-reached step is CANCELLED.
    updatePayload.steps = steps.map((s, i) => {
      if (i < currentStep) return s;
      if (i === currentStep) return { ...s, status: action === "approve" ? "APPROVED" : "REJECTED", approver_user_id: userId, decided_at: new Date().toISOString() };
      return { ...s, status: "CANCELLED" };
    });
  }

  const { error: updateError } = await supabase.from("approval_requests").update(updatePayload).eq("id", approvalId).eq("tenant_id", tenantId);
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

  // "Edit and Approve" note (if any) was already recorded above, before the
  // multi-step early-return check, so it is captured on every approve — not
  // just a chain's final step.
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
    return;
  }

  if (approval.type === "deal_won") {
    if (action === "reject") {
      // "Not won yet" — send the deal back to Negotiation rather than
      // silently dropping it; a CEO reject here is not the same as LOST
      // (that is its own explicit action, spec §57).
      await supabase.from("opportunities").update({ stage: "NEGOTIATION" }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    }
    return;
  }

  if (approval.type === "contract_approval") {
    await supabase.from("contracts").update({ status: "rejected" }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    return;
  }

  if (approval.type === "sales_send" || approval.type === "sales_reply") {
    const status = action === "hold" ? undefined : "CANCELLED";
    if (status) {
      await supabase.from("sales_messages").update({ status }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    }
    if (action === "do_not_contact") {
      const { data: message } = await supabase.from("sales_messages").select("lead_id").eq("id", approval.subject_id).eq("tenant_id", tenantId).maybeSingle();
      if (message) {
        const { data: lead } = await supabase.from("leads").select("company_name, domain").eq("id", message.lead_id as string).eq("tenant_id", tenantId).maybeSingle();
        if (lead) {
          await addToDoNotContact(supabase, tenantId, {
            companyName: lead.company_name as string,
            domain: lead.domain as string | null,
            reason: reason ?? "CEOが今後営業しないと判断",
            createdByUserId: ctx.userId,
          });
        }
      }
    }
    return;
  }

  if (approval.type === "proposal_approval") {
    const status = action === "revise" ? "REVISION_REQUESTED" : action === "reject" ? "REJECTED" : undefined;
    if (status) {
      await supabase.from("proposals").update({ status }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    }
    if (action === "do_not_contact") {
      const { data: proposal } = await supabase.from("proposals").select("opportunity_id").eq("id", approval.subject_id).eq("tenant_id", tenantId).maybeSingle();
      if (proposal) {
        const { data: opp } = await supabase.from("opportunities").select("lead_id").eq("id", proposal.opportunity_id as string).eq("tenant_id", tenantId).maybeSingle();
        if (opp) {
          await supabase
            .from("opportunities")
            .update({ stage: "LOST", lost_reason: "other", lost_detail: reason ?? null })
            .eq("id", proposal.opportunity_id as string)
            .eq("tenant_id", tenantId);
          const { data: lead } = await supabase.from("leads").select("company_name, domain").eq("id", opp.lead_id as string).eq("tenant_id", tenantId).maybeSingle();
          if (lead) {
            await addToDoNotContact(supabase, tenantId, {
              companyName: lead.company_name as string,
              domain: lead.domain as string | null,
              reason: reason ?? "CEOが今後営業しないと判断",
              createdByUserId: ctx.userId,
            });
          }
        }
      }
    }
  }
  if (approval.type === "monthly_report") {
    const status = action === "revise" ? "REVISION" : action === "reject" ? "REJECTED" : undefined;
    if (status) {
      await supabase.from("monthly_reports").update({ status }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    }
    return;
  }

  if (approval.type === "upsell_opportunity") {
    if (action === "reject") {
      const cooldownUntil = computeCooldownUntil(new Date(), 90);
      await supabase
        .from("upsell_opportunities")
        .update({ status: "REJECTED", rejected_reason: reason ?? null, cooldown_until: cooldownUntil.toISOString().slice(0, 10) })
        .eq("id", approval.subject_id)
        .eq("tenant_id", tenantId);
    } else if (action === "hold") {
      await supabase.from("upsell_opportunities").update({ status: "ON_HOLD" }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    }
    return;
  }
  if (approval.type === "work_creation" && action === "reject") {
    // AI Company OS PHASE 1: a human rejecting an AuthorityEngine-routed
    // Work is exactly as terminal as AuthorityEngine's own DENY — see
    // lib/autonomy/authorityEngine.ts's STATUS_BY_DECISION.
    await transitionWork(ctx.supabase, ctx.tenantId, approval.subject_id, "DENIED");
    if (approval.cycle_id) {
      await writeWorkHumanInterventionLog(ctx, { cycleId: approval.cycle_id, workId: approval.subject_id, action: "REJECT", reason });
    }
    return;
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

  if (approval.type === "sales_outreach" || approval.type === "deal_won") {
    return finalizeWonAndStartContract(ctx, approval.subject_id);
  }

  if (approval.type === "sales_send" || approval.type === "sales_reply") {
    // "Create External Draft" (spec §3): a safe, non-external-effect system
    // step that runs automatically right after CEO approval — the human
    // gate is Approve here and the separate Final Send Gate later, not a
    // third gate in between.
    const { data: message, error } = await supabase
      .from("sales_messages")
      .select("direction, to_address, subject, body")
      .eq("id", approval.subject_id)
      .eq("tenant_id", tenantId)
      .single();
    if (error || !message) throw error ?? new Error("sales_message not found");

    // An INBOUND subject means this is a DO_NOT_CONTACT alert (spec §18) —
    // there is no outbound draft to create; approving it just acknowledges
    // the alert. Registering the actual DNC entry happens via the
    // "do_not_contact" action, not "approve" (see applyNonApproval above).
    if (message.direction === "INBOUND") {
      return { acknowledged: true };
    }

    const connector = await getEmailConnector({ supabase, tenantId, userId });
    const draft = await connector.createDraft({ to: message.to_address as string, subject: message.subject as string, body: message.body as string });
    await supabase
      .from("sales_messages")
      .update({ status: "READY_TO_SEND", provider: draft.provider, provider_draft_id: draft.providerDraftId })
      .eq("id", approval.subject_id)
      .eq("tenant_id", tenantId);

    return { messageId: approval.subject_id, readyToSend: true, provider: draft.provider };
  }

  if (approval.type === "proposal_approval") {
    const { data: proposal, error } = await supabase
      .from("proposals")
      .select("id, opportunity_id")
      .eq("id", approval.subject_id)
      .eq("tenant_id", tenantId)
      .single();
    if (error || !proposal) throw error ?? new Error("Proposal not found");

    const { data: estimate } = await supabase
      .from("estimates")
      .select("subtotal, discount, tax, total, setup_fee, monthly_fee, annual_value")
      .eq("proposal_id", proposal.id as string)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Snapshot the estimate into the proposal at the moment of approval
    // (spec §37/§50): changing the estimate/proposal later must never
    // retroactively change what was actually sent to the client.
    await supabase
      .from("proposals")
      .update({ status: "APPROVED", approved_by_user_id: userId, price_summary: estimate ?? null })
      .eq("id", approval.subject_id)
      .eq("tenant_id", tenantId);
    await supabase.from("opportunities").update({ stage: "PROPOSAL_PREPARATION" }).eq("id", proposal.opportunity_id as string).eq("tenant_id", tenantId);

    return { proposalId: proposal.id, approvedForDelivery: true };
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

  if (approval.type === "monthly_report") {
    // APPROVED here means internally approved (Manager+CEO chain) — the
    // actual "hand this to the client" send is still a separate explicit
    // Human Action (spec §55-56), same split as project delivery.
    await supabase.from("monthly_reports").update({ status: "APPROVED" }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    return { monthlyReportId: approval.subject_id, approvedForDelivery: true };
  }

  if (approval.type === "upsell_opportunity") {
    // Opportunity Conversion (spec §79): an approved upsell becomes a new
    // Sales Opportunity on the *existing* pipeline, not a parallel one.
    const { data: upsell, error } = await supabase
      .from("upsell_opportunities")
      .select("id, client_id, recommended_service, problem, business_impact, estimated_value")
      .eq("id", approval.subject_id)
      .eq("tenant_id", tenantId)
      .single();
    if (error || !upsell) throw error ?? new Error("Upsell opportunity not found");

    const { data: client } = await supabase.from("clients").select("name, industry").eq("id", upsell.client_id as string).eq("tenant_id", tenantId).maybeSingle();

    // Opportunities require a lead_id (existing sales schema) — an upsell has
    // no cold-outreach lead, so a lightweight "already a client" lead row is
    // created to satisfy that FK without inventing a parallel data model.
    const { data: leadRow, error: leadError } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        company_name: (client?.name as string | undefined) ?? "既存クライアント",
        industry: (client?.industry as string | undefined) ?? null,
        source: "upsell_expansion",
        status: "won",
      })
      .select("id")
      .single();
    if (leadError || !leadRow) throw leadError ?? new Error("Failed to create expansion lead");

    const { data: oppRow, error: oppError } = await supabase
      .from("opportunities")
      .insert({
        tenant_id: tenantId,
        lead_id: leadRow.id,
        client_id: upsell.client_id,
        stage: "QUALIFIED",
        services: [{ service: upsell.recommended_service, reason: upsell.problem }],
        estimated_value: upsell.estimated_value ?? null,
        notes: `Upsell Opportunity由来: ${upsell.business_impact ?? upsell.problem}`,
      })
      .select("id")
      .single();
    if (oppError || !oppRow) throw oppError ?? new Error("Failed to create expansion opportunity");

    await supabase.from("upsell_opportunities").update({ status: "APPROVED", converted_opportunity_id: oppRow.id }).eq("id", approval.subject_id).eq("tenant_id", tenantId);
    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "upsell.converted",
      message: `アップセル提案を新規Sales Opportunityへ変換しました`,
      payload: { upsellOpportunityId: approval.subject_id, opportunityId: oppRow.id },
    });

    return { opportunityId: oppRow.id, converted: true };
  }

  if (approval.type === "work_creation") {
    await transitionWork(ctx.supabase, ctx.tenantId, approval.subject_id, "APPROVED");
    if (approval.cycle_id) {
      await writeWorkHumanInterventionLog(ctx, { cycleId: approval.cycle_id, workId: approval.subject_id, action: "APPROVE" });
    }
    return { workId: approval.subject_id, authorized: true };
  }

  throw new ValidationError(`Unknown approval type: ${approval.type}`);
}

/**
 * Shared by both `sales_outreach` (Phase 1's legacy no-outreach-modeled
 * flow, still supported) and `deal_won` (Phase 4's WON gate after
 * Proposal/Estimate/Negotiation) — the final "commit to WON" decision looks
 * identical from here regardless of how the opportunity got to this point,
 * so both approval types run the exact same already-built
 * `sales_graph` -> `contract_graph` chain (spec §55-56: connect back into
 * the existing Contract Workflow, don't rebuild it).
 */
async function finalizeWonAndStartContract(ctx: TenantContext, opportunityId: string): Promise<Record<string, unknown>> {
  const { supabase, tenantId } = ctx;

  const { data: opp, error } = await supabase.from("opportunities").select("id, lead_id, amount, estimated_value").eq("id", opportunityId).single();
  if (error || !opp) throw error ?? new Error("Opportunity not found");

  // `sales_graph`'s finalize_won reads/writes `opportunities.amount` — keep
  // it in sync with the richer `estimated_value` Phase 4 populates, so the
  // existing Phase 1 contract_graph (and CEO Inbox amount display) keep
  // working unchanged.
  if (opp.amount == null && opp.estimated_value != null) {
    await supabase.from("opportunities").update({ amount: opp.estimated_value }).eq("id", opportunityId).eq("tenant_id", tenantId);
  }

  const salesResult = await runBusinessGraph({
    supabase,
    tenantId,
    graphName: "sales_graph",
    subjectType: "opportunity",
    subjectId: opp.id as string,
    input: { opportunityId: opp.id, leadId: opp.lead_id },
  });
  await supabase.from("opportunities").update({ stage: "WON" }).eq("id", opportunityId).eq("tenant_id", tenantId);

  if (salesResult.status !== "completed") return { sales: salesResult };

  const { data: lead, error: leadError } = await supabase.from("leads").select("company_name, industry").eq("id", opp.lead_id as string).single();
  if (leadError || !lead) throw leadError ?? new Error("Lead not found");

  const contractResult = await runBusinessGraph({
    supabase,
    tenantId,
    graphName: "contract_graph",
    subjectType: "opportunity",
    subjectId: opp.id as string,
    input: { opportunityId: opp.id, companyName: lead.company_name, amount: opp.amount ?? opp.estimated_value },
  });

  return { sales: salesResult, contract: contractResult };
}
