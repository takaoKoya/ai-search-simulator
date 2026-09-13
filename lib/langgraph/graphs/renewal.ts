import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";

const RenewalState = Annotation.Root({
  projectId: lastValue<string>(),
  companyName: lastValue<string>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type RenewalStateType = typeof RenewalState.State;

/**
 * Manually triggered continuation/upsell suggestion. Creates a proposal draft
 * for a human to review — never sends anything externally or confirms a
 * contract change on its own.
 */
export function buildRenewalGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(RenewalState)
    .addNode("propose_renewal", async (state) => {
      await ctx.supabase.from("initiatives").insert({
        tenant_id: ctx.tenantId,
        project_id: state.projectId,
        title: `${state.companyName}様への継続提案`,
        description: "月次実績をもとにした継続・アップセル提案の下書き(人間の確認が必要)",
        status: "open",
      });
      await emitEvent(ctx, { eventType: "initiative.created", message: "継続提案の下書きを作成しました" });
      return { status: "completed" as GraphStatus, currentNode: "propose_renewal" };
    })
    .addEdge(START, "propose_renewal")
    .addEdge("propose_renewal", END)
    .compile({ checkpointer });
}
