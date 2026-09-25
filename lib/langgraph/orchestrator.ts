import { randomUUID } from "crypto";
import type { SupabaseServerClient } from "@/lib/server/tenant";
import { createGraphRunCtx, emitEvent } from "@/lib/langgraph/context";
import { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { buildLeadGenerationGraph } from "@/lib/langgraph/graphs/leadGeneration";
import { buildSalesGraph } from "@/lib/langgraph/graphs/sales";
import { buildContractGraph } from "@/lib/langgraph/graphs/contract";
import { buildOnboardingGraph } from "@/lib/langgraph/graphs/onboarding";
import { buildExecutionGraph } from "@/lib/langgraph/graphs/execution";
import { buildDeliveryGraph } from "@/lib/langgraph/graphs/delivery";
import { buildMeasurementGraph } from "@/lib/langgraph/graphs/measurement";
import { buildRenewalGraph } from "@/lib/langgraph/graphs/renewal";
import { buildLeadDiscoveryGraph } from "@/lib/langgraph/graphs/leadDiscovery";
import { buildSalesDraftGraph } from "@/lib/langgraph/graphs/salesDraft";
import { buildSalesOutreachPrepGraph } from "@/lib/langgraph/graphs/salesOutreachPrep";
import { buildReplyAnalysisGraph } from "@/lib/langgraph/graphs/replyAnalysis";
import { buildMeetingSchedulingGraph } from "@/lib/langgraph/graphs/meetingScheduling";
import { buildMeetingPrepGraph } from "@/lib/langgraph/graphs/meetingPrep";
import { buildMeetingMinutesGraph } from "@/lib/langgraph/graphs/meetingMinutes";
import { buildProposalDraftGraph } from "@/lib/langgraph/graphs/proposalDraft";
import { buildNegotiationAnalysisGraph } from "@/lib/langgraph/graphs/negotiationAnalysis";
import { buildDealWonGateGraph } from "@/lib/langgraph/graphs/dealWonGate";

export const GRAPH_NAMES = [
  "lead_discovery_graph",
  "lead_generation_graph",
  "sales_graph",
  "sales_draft_graph",
  "sales_outreach_prep_graph",
  "reply_analysis_graph",
  "meeting_scheduling_graph",
  "meeting_prep_graph",
  "meeting_minutes_graph",
  "proposal_draft_graph",
  "negotiation_analysis_graph",
  "deal_won_gate_graph",
  "contract_graph",
  "onboarding_graph",
  "execution_graph",
  "delivery_graph",
  "measurement_graph",
  "renewal_graph",
] as const;

export type GraphName = (typeof GRAPH_NAMES)[number];

interface RunBusinessGraphParams {
  supabase: SupabaseServerClient;
  tenantId: string;
  graphName: GraphName;
  subjectType: string;
  subjectId: string;
  input: Record<string, unknown>;
  /** Set only by the AI Company OS Autonomy Runtime's Execution Adapter (lib/autonomy/executionAdapter.ts) — links this run back to its autonomy_cycles row. Every pre-PHASE-1 (human-triggered) call omits it, leaving workflow_runs.cycle_id null, exactly as before. */
  cycleId?: string;
}

/**
 * BusinessOrchestrator: the single entry point that runs one graph segment,
 * persists its outcome to `workflow_runs`, and chains the next segment when
 * a phase completes without pausing for human approval (today: onboarding
 * -> execution). Human-approval boundaries are NOT resumed via LangGraph's
 * own interrupt mechanism — each phase is its own graph/workflow_run, and
 * the approval decision route (`/api/approvals/[id]/decide`) starts the next
 * one explicitly. This keeps "pause for days waiting on a human" a plain DB
 * row (`approval_requests.status = 'pending'`) rather than a long-lived
 * in-process graph suspension.
 */
export async function runBusinessGraph(params: RunBusinessGraphParams): Promise<Record<string, unknown>> {
  const { supabase, tenantId, graphName, subjectType, subjectId, input, cycleId } = params;

  // thread_id is generated here (not left to the column default) so the
  // graph can be invoked with a known thread_id in the same request.
  const threadIdForInsert = randomUUID();
  const { data: runRow, error } = await supabase
    .from("workflow_runs")
    .insert({
      tenant_id: tenantId,
      graph_name: graphName,
      subject_type: subjectType,
      subject_id: subjectId,
      status: "running",
      cycle_id: cycleId ?? null,
      thread_id: threadIdForInsert,
    })
    .select("id, thread_id")
    .single();
  if (error || !runRow) throw error ?? new Error("Failed to create workflow_run");

  const workflowRunId = runRow.id as string;
  const threadId = runRow.thread_id as string;
  const ctx = createGraphRunCtx(supabase, tenantId, workflowRunId);
  const checkpointer = new SupabaseCheckpointSaver(supabase, tenantId, workflowRunId);
  const config = { configurable: { thread_id: threadId }, recursionLimit: 100 };

  await emitEvent(ctx, { eventType: "workflow.started", message: `${GRAPH_LABEL[graphName]}を開始`, payload: { graphName, subjectType, subjectId } });

  try {
    const finalState = await invokeGraph(graphName, ctx, checkpointer, input, config);
    const status = (finalState.status as string) ?? "completed";

    await supabase
      .from("workflow_runs")
      .update({ status, current_node: (finalState.currentNode as string) ?? null, state: finalState })
      .eq("id", workflowRunId)
      .eq("tenant_id", tenantId);

    await emitEvent(ctx, {
      eventType: status === "waiting_human" ? "workflow.waiting_human" : status === "failed" ? "workflow.failed" : "workflow.completed",
      message: `${GRAPH_LABEL[graphName]}が${status === "waiting_human" ? "人間の承認待ちで一時停止" : status === "failed" ? "失敗" : "完了"}`,
      payload: { graphName, currentNode: finalState.currentNode ?? null },
    });

    if (graphName === "onboarding_graph" && status === "completed" && finalState.projectId) {
      await runBusinessGraph({
        supabase,
        tenantId,
        graphName: "execution_graph",
        subjectType: "project",
        subjectId: finalState.projectId as string,
        input: { projectId: finalState.projectId },
      });
    }

    return finalState;
  } catch (err) {
    await supabase.from("workflow_runs").update({ status: "failed" }).eq("id", workflowRunId).eq("tenant_id", tenantId);
    const message = err instanceof Error ? err.message : String(err);
    await emitEvent(ctx, { eventType: "workflow.failed", message: `${GRAPH_LABEL[graphName]}が失敗: ${message}` });
    throw err;
  }
}

const GRAPH_LABEL: Record<GraphName, string> = {
  lead_discovery_graph: "Lead Discovery",
  lead_generation_graph: "Lead Generation",
  sales_graph: "Sales",
  sales_draft_graph: "Sales Draft",
  sales_outreach_prep_graph: "Sales Outreach Prep",
  reply_analysis_graph: "Reply Analysis",
  meeting_scheduling_graph: "Meeting Scheduling",
  meeting_prep_graph: "Meeting Prep",
  meeting_minutes_graph: "Meeting Minutes",
  proposal_draft_graph: "Proposal Draft",
  negotiation_analysis_graph: "Negotiation Analysis",
  deal_won_gate_graph: "Deal Won Gate",
  contract_graph: "Contract Review",
  onboarding_graph: "Onboarding",
  execution_graph: "Execution",
  delivery_graph: "Delivery",
  measurement_graph: "Measurement",
  renewal_graph: "Renewal",
};

/**
 * Durable-execution recovery: rebuilds the same graph/checkpointer/thread
 * for an existing (e.g. crashed mid-run) workflow_run and resumes it. Passing
 * `null` as input tells LangGraph to continue from the last checkpoint
 * instead of starting over.
 */
export async function resumeBusinessGraph(supabase: SupabaseServerClient, tenantId: string, workflowRunId: string): Promise<Record<string, unknown>> {
  const { data: runRow, error } = await supabase
    .from("workflow_runs")
    .select("id, thread_id, graph_name")
    .eq("id", workflowRunId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !runRow) throw error ?? new Error("workflow_run not found");

  const ctx = createGraphRunCtx(supabase, tenantId, workflowRunId);
  const checkpointer = new SupabaseCheckpointSaver(supabase, tenantId, workflowRunId);
  const config = { configurable: { thread_id: runRow.thread_id as string }, recursionLimit: 100 };
  const graphName = runRow.graph_name as GraphName;

  await emitEvent(ctx, { eventType: "workflow.resumed", message: `${GRAPH_LABEL[graphName]}をCheckpointから再開` });

  const finalState = await invokeGraph(graphName, ctx, checkpointer, null, config);
  const status = (finalState.status as string) ?? "completed";
  await supabase
    .from("workflow_runs")
    .update({ status, current_node: (finalState.currentNode as string) ?? null, state: finalState })
    .eq("id", workflowRunId)
    .eq("tenant_id", tenantId);
  await emitEvent(ctx, {
    eventType: status === "waiting_human" ? "workflow.waiting_human" : status === "failed" ? "workflow.failed" : "workflow.completed",
    message: `${GRAPH_LABEL[graphName]}が${status === "waiting_human" ? "人間の承認待ちで一時停止" : status === "failed" ? "失敗" : "完了"}`,
  });
  return finalState;
}

function invokeGraph(
  graphName: GraphName,
  ctx: ReturnType<typeof createGraphRunCtx>,
  checkpointer: SupabaseCheckpointSaver,
  input: Record<string, unknown> | null,
  config: { configurable: { thread_id: string }; recursionLimit: number }
): Promise<Record<string, unknown>> {
  switch (graphName) {
    case "lead_discovery_graph":
      return buildLeadDiscoveryGraph(ctx, checkpointer).invoke(input, config);
    case "lead_generation_graph":
      return buildLeadGenerationGraph(ctx, checkpointer).invoke(input, config);
    case "sales_graph":
      return buildSalesGraph(ctx, checkpointer).invoke(input, config);
    case "sales_draft_graph":
      return buildSalesDraftGraph(ctx, checkpointer).invoke(input, config);
    case "sales_outreach_prep_graph":
      return buildSalesOutreachPrepGraph(ctx, checkpointer).invoke(input, config);
    case "reply_analysis_graph":
      return buildReplyAnalysisGraph(ctx, checkpointer).invoke(input, config);
    case "meeting_scheduling_graph":
      return buildMeetingSchedulingGraph(ctx, checkpointer).invoke(input, config);
    case "meeting_prep_graph":
      return buildMeetingPrepGraph(ctx, checkpointer).invoke(input, config);
    case "meeting_minutes_graph":
      return buildMeetingMinutesGraph(ctx, checkpointer).invoke(input, config);
    case "proposal_draft_graph":
      return buildProposalDraftGraph(ctx, checkpointer).invoke(input, config);
    case "negotiation_analysis_graph":
      return buildNegotiationAnalysisGraph(ctx, checkpointer).invoke(input, config);
    case "deal_won_gate_graph":
      return buildDealWonGateGraph(ctx, checkpointer).invoke(input, config);
    case "contract_graph":
      return buildContractGraph(ctx, checkpointer).invoke(input, config);
    case "onboarding_graph":
      return buildOnboardingGraph(ctx, checkpointer).invoke(input, config);
    case "execution_graph":
      return buildExecutionGraph(ctx, checkpointer).invoke(input, config);
    case "delivery_graph":
      return buildDeliveryGraph(ctx, checkpointer).invoke(input, config);
    case "measurement_graph":
      return buildMeasurementGraph(ctx, checkpointer).invoke(input, config);
    case "renewal_graph":
      return buildRenewalGraph(ctx, checkpointer).invoke(input, config);
    default: {
      const exhaustive: never = graphName;
      throw new Error(`Unknown graph: ${exhaustive}`);
    }
  }
}
