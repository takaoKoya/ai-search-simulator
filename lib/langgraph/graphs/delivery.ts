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

/**
 * READY_FOR_DELIVERY vs DELIVERED (Growth Loop spec §2-3): this graph runs
 * right after the internal "delivery" approval_request is APPROVED — that is
 * an internal decision, not the act of handing the work to the client. It
 * only advances the project to `ready_for_delivery`; the actual `delivered`
 * transition + `delivery_records` row is a separate explicit Human Action
 * (see lib/server/deliveryConfirmation.ts / POST /api/projects/[id]/delivery/confirm).
 */
export function buildDeliveryGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(DeliveryState)
    .addNode("mark_ready_for_delivery", async (state) => {
      await ctx.supabase.from("projects").update({ status: "ready_for_delivery" }).eq("id", state.projectId).eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, { eventType: "delivery.ready", message: "内部承認が完了し、納品可能な状態になりました(READY_FOR_DELIVERY)" });
      return { status: "completed" as GraphStatus, currentNode: "mark_ready_for_delivery" };
    })
    .addEdge(START, "mark_ready_for_delivery")
    .addEdge("mark_ready_for_delivery", END)
    .compile({ checkpointer });
}
