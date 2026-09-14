import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { createApprovalRequest, emitEvent, runAgentStep, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { getProviderForAgent } from "@/lib/ai/provider";

const ExecutionState = Annotation.Root({
  projectId: lastValue<string>(),
  nextTaskId: lastValue<string | undefined>(),
  nextTaskTitle: lastValue<string | undefined>(),
  nextTaskAgentCode: lastValue<string | undefined>(),
  currentDeliverableId: lastValue<string | undefined>(),
  criticPassed: lastValue<boolean | undefined>(),
  approvalRequestId: lastValue<string | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type ExecutionStateType = typeof ExecutionState.State;

export function buildExecutionGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(ExecutionState)
    .addNode("next_task", async (state) => {
      const { data: task, error } = await ctx.supabase
        .from("tasks")
        .select("id, title, assigned_agent_id")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", state.projectId)
        .eq("status", "todo")
        .order("sequence", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!task) {
        return { nextTaskId: undefined, currentNode: "next_task" };
      }
      const { data: agent, error: agentError } = await ctx.supabase
        .from("agents")
        .select("code")
        .eq("id", task.assigned_agent_id)
        .single();
      if (agentError || !agent) throw agentError ?? new Error("Assigned agent not found");
      return {
        nextTaskId: task.id as string,
        nextTaskTitle: task.title as string,
        nextTaskAgentCode: agent.code as string,
        currentNode: "next_task",
      };
    })
    .addNode("execute_task", async (state) => {
      await emitEvent(ctx, {
        eventType: "task.started",
        message: `${state.nextTaskTitle}を開始`,
        payload: { taskId: state.nextTaskId },
      });
      const result = await runAgentStep(
        ctx,
        {
          agentCode: state.nextTaskAgentCode!,
          nodeName: "execute_task",
          input: { taskId: state.nextTaskId, title: state.nextTaskTitle },
          projectId: state.projectId,
          taskId: state.nextTaskId,
        },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const generated = await provider.generate("execution_task", { title: state.nextTaskTitle });
          const { data: deliverable, error } = await ctx.supabase
            .from("deliverables")
            .insert({
              tenant_id: ctx.tenantId,
              project_id: state.projectId,
              task_id: state.nextTaskId,
              title: `${state.nextTaskTitle} 成果物`,
              type: "document",
              content: { body: generated.data.output },
              status: "in_review",
            })
            .select("id")
            .single();
          if (error || !deliverable) throw error ?? new Error("Failed to create deliverable");
          await ctx.supabase.from("tasks").update({ status: "in_review" }).eq("id", state.nextTaskId).eq("tenant_id", ctx.tenantId);
          return { output: generated.data, summary: generated.summary, result: { deliverableId: deliverable.id as string } };
        }
      );
      return { currentDeliverableId: result.deliverableId, currentNode: "execute_task" };
    })
    .addNode("critic_task", async (state) => {
      const { data: deliverable } = await ctx.supabase
        .from("deliverables")
        .select("content")
        .eq("id", state.currentDeliverableId)
        .single();
      const body = (deliverable?.content as { body?: string } | null)?.body ?? "";
      const result = await runAgentStep(
        ctx,
        {
          agentCode: "kuro",
          nodeName: "critic_task",
          input: { deliverableId: state.currentDeliverableId },
          projectId: state.projectId,
          taskId: state.nextTaskId,
        },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const res = await provider.generate("critic_review", { subjectSummary: body });
          return { output: res.data, summary: res.summary, result: res.data };
        }
      );
      const passed = Boolean(result.passed);
      await emitEvent(ctx, {
        eventType: "critic.reviewed",
        message: passed ? `${state.nextTaskTitle}: Criticレビュー通過` : `${state.nextTaskTitle}: Criticが差し戻し`,
        payload: { taskId: state.nextTaskId, passed },
      });
      if (!passed) {
        await ctx.supabase.from("tasks").update({ status: "blocked" }).eq("id", state.nextTaskId).eq("tenant_id", ctx.tenantId);
        await emitEvent(ctx, { eventType: "critic.rejected", message: "Criticがタスク成果物を差し戻し", payload: { taskId: state.nextTaskId } });
        await emitEvent(ctx, { eventType: "task.blocked", message: `${state.nextTaskTitle}がブロック状態に`, payload: { taskId: state.nextTaskId } });
      }
      return { criticPassed: passed, currentNode: "critic_task" };
    })
    .addNode("qa_task", async (state) => {
      if (!state.criticPassed) {
        return { currentNode: "qa_task" };
      }
      await emitEvent(ctx, { eventType: "qa.started", message: `${state.nextTaskTitle}のQAを開始`, payload: { taskId: state.nextTaskId } });
      const qaResult = await runAgentStep(
        ctx,
        {
          agentCode: "qa",
          nodeName: "qa_check",
          input: { deliverableId: state.currentDeliverableId },
          projectId: state.projectId,
          taskId: state.nextTaskId,
        },
        async (agent) => {
          const provider = getProviderForAgent(agent);
          const res = await provider.generate("qa_check", { deliverableTitle: state.nextTaskTitle });
          return { output: res.data, summary: res.summary, result: res.data };
        }
      );
      if (!qaResult.passed) {
        await ctx.supabase.from("tasks").update({ status: "blocked" }).eq("id", state.nextTaskId).eq("tenant_id", ctx.tenantId);
        await emitEvent(ctx, { eventType: "qa.failed", message: `${state.nextTaskTitle}のQAで問題を検出`, payload: { taskId: state.nextTaskId } });
        return { currentNode: "qa_task" };
      }
      await ctx.supabase.from("deliverables").update({ status: "approved" }).eq("id", state.currentDeliverableId).eq("tenant_id", ctx.tenantId);
      await ctx.supabase.from("tasks").update({ status: "done" }).eq("id", state.nextTaskId).eq("tenant_id", ctx.tenantId);
      await emitEvent(ctx, { eventType: "qa.passed", message: "QAを通過しました", payload: { taskId: state.nextTaskId } });
      await emitEvent(ctx, { eventType: "task.completed", message: `${state.nextTaskTitle}が完了`, payload: { taskId: state.nextTaskId } });
      return { currentNode: "qa_task" };
    })
    .addNode("request_delivery_approval", async (state) => {
      const approvalId = await createApprovalRequest(ctx, {
        type: "delivery",
        subjectType: "project",
        subjectId: state.projectId,
        title: "成果物の納品承認",
        aiRecommendation: "全タスク完了・QA通過のため納品を推奨します。",
        requestedByAgentCode: "taku",
      });
      return { approvalRequestId: approvalId, status: "waiting_human" as GraphStatus, currentNode: "request_delivery_approval" };
    })
    .addEdge(START, "next_task")
    .addConditionalEdges("next_task", (state) => (state.nextTaskId ? "execute" : "finish"), {
      execute: "execute_task",
      finish: "request_delivery_approval",
    })
    .addEdge("execute_task", "critic_task")
    .addEdge("critic_task", "qa_task")
    .addEdge("qa_task", "next_task")
    .addEdge("request_delivery_approval", END)
    .compile({ checkpointer });
}
