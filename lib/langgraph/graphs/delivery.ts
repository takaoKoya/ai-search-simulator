import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";

const DeliveryState = Annotation.Root({
  projectId: lastValue<string>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type DeliveryStateType = typeof DeliveryState.State;

export function buildDeliveryGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(DeliveryState)
    .addNode("finalize_delivery", async (state) => {
      await ctx.supabase.from("projects").update({ status: "delivered" }).eq("id", state.projectId).eq("tenant_id", ctx.tenantId);
      await ctx.supabase
        .from("deliverables")
        .update({ status: "delivered" })
        .eq("project_id", state.projectId)
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "approved");
      await emitEvent(ctx, { eventType: "delivery.completed", message: "成果物を納品しました" });
      return { status: "completed" as GraphStatus, currentNode: "finalize_delivery" };
    })
    .addEdge(START, "finalize_delivery")
    .addEdge("finalize_delivery", END)
    .compile({ checkpointer });
}
