import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { SupabaseCheckpointSaver } from "@/lib/langgraph/checkpointer";
import { emitEvent, getAgentByCode, type GraphRunCtx } from "@/lib/langgraph/context";
import { lastValue, type GraphStatus } from "@/lib/langgraph/state";
import { pickProjectType, projectTypeLabel, taskTemplatesFor, teamAgentCodesFor, type ProjectType } from "@/lib/langgraph/projectTemplates";

const OnboardingState = Annotation.Root({
  contractId: lastValue<string>(),
  companyName: lastValue<string>(),
  industry: lastValue<string | undefined>(),
  projectId: lastValue<string | undefined>(),
  projectType: lastValue<ProjectType | undefined>(),
  status: lastValue<GraphStatus>("running"),
  currentNode: lastValue<string | undefined>(),
});

export type OnboardingStateType = typeof OnboardingState.State;

export function buildOnboardingGraph(ctx: GraphRunCtx, checkpointer: SupabaseCheckpointSaver) {
  return new StateGraph(OnboardingState)
    .addNode("create_project", async (state) => {
      const { data: existingClient } = await ctx.supabase
        .from("clients")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("name", state.companyName)
        .maybeSingle();

      let clientId: string;
      if (existingClient) {
        clientId = existingClient.id as string;
      } else {
        const { data: newClient, error } = await ctx.supabase
          .from("clients")
          .insert({ tenant_id: ctx.tenantId, name: state.companyName, industry: state.industry ?? null })
          .select("id")
          .single();
        if (error || !newClient) throw error ?? new Error("Failed to create client");
        clientId = newClient.id as string;
      }

      const projectType = pickProjectType(state.industry);
      const { data: project, error: projectError } = await ctx.supabase
        .from("projects")
        .insert({
          tenant_id: ctx.tenantId,
          contract_id: state.contractId,
          client_id: clientId,
          name: `${state.companyName} ${projectTypeLabel(projectType)}プロジェクト`,
          project_type: projectType,
          status: "active",
        })
        .select("id")
        .single();
      if (projectError || !project) throw projectError ?? new Error("Failed to create project");

      await ctx.supabase.from("goals").insert({
        tenant_id: ctx.tenantId,
        project_id: project.id,
        title: "問い合わせ数の増加",
        target_value: 10,
        unit: "件/月",
      });

      await emitEvent(ctx, {
        eventType: "project.created",
        message: `${state.companyName}のプロジェクトを作成`,
        payload: { projectId: project.id },
      });

      return { projectId: project.id as string, projectType, currentNode: "create_project" };
    })
    .addNode("form_team", async (state) => {
      const codes = teamAgentCodesFor(state.projectType!);
      for (const code of codes) {
        const agent = await getAgentByCode(ctx, code);
        await ctx.supabase.from("project_team_members").insert({
          tenant_id: ctx.tenantId,
          project_id: state.projectId,
          agent_id: agent.id,
          role_in_project: code,
        });
      }
      await emitEvent(ctx, {
        eventType: "team.created",
        message: `AI Teamを編成しました(${codes.length}名)`,
        payload: { projectId: state.projectId, codes },
      });
      return { currentNode: "form_team" };
    })
    .addNode("create_tasks", async (state) => {
      const templates = taskTemplatesFor(state.projectType!);
      const taskIds: string[] = [];
      let sequence = 0;
      for (const template of templates) {
        sequence += 1;
        const agent = await getAgentByCode(ctx, template.agentCode);
        const { data: task, error } = await ctx.supabase
          .from("tasks")
          .insert({
            tenant_id: ctx.tenantId,
            project_id: state.projectId,
            title: template.title,
            assigned_agent_id: agent.id,
            status: "todo",
            sequence,
          })
          .select("id")
          .single();
        if (error || !task) throw error ?? new Error("Failed to create task");
        taskIds.push(task.id as string);
      }
      await emitEvent(ctx, {
        eventType: "task.created",
        message: `初期タスクを${taskIds.length}件生成しました`,
        payload: { projectId: state.projectId, taskIds },
      });
      return { status: "completed" as GraphStatus, currentNode: "create_tasks" };
    })
    .addEdge(START, "create_project")
    .addEdge("create_project", "form_team")
    .addEdge("form_team", "create_tasks")
    .addEdge("create_tasks", END)
    .compile({ checkpointer });
}
