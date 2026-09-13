import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";

const MeasurementState = Annotation.Root({
  projectId: lastValue<string>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type MeasurementStateType = typeof MeasurementState.State;

/** Manually triggered (or later, cron-scheduled) monthly measurement/report pass. */
export function buildMeasurementGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(MeasurementState)
    .addNode("compute_and_report", async (state) => {
      const { data: project } = await ctx.supabase.from("projects").select("name").eq("id", state.projectId).single();
      const result = await runAgentStep(
        ctx,
        { agentCode: "repo", nodeName: "report", input: { projectId: state.projectId }, projectId: state.projectId },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const res = await provider.generate("report", { projectName: project?.name });
          return { output: res.data, summary: res.summary, result: res.data };
        }
      );
      await ctx.supabase
        .from("kpis")
        .update({ measured_at: new Date().toISOString() })
        .eq("project_id", state.projectId)
        .eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, { eventType: "report.created", message: "月次レポートを作成しました", payload: result });
      return { status: "completed" as GraphStatus, currentNode: "compute_and_report" };
    })
    .addEdge(START, "compute_and_report")
    .addEdge("compute_and_report", END)
    .compile({ checkpointer });
}
