import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: agent, error } = await supabase
      .from("agents")
      .select("id, code, name, role, job_title, description, status, provider, model, avatar, current_project_id, current_task_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!agent) throw new NotFoundError("Agent not found");

    const [runsRes, eventsRes, findingsRes] = await Promise.all([
      supabase
        .from("agent_runs")
        .select("id, workflow_run_id, node_name, status, input, output, started_at, completed_at, error")
        .eq("tenant_id", tenantId)
        .eq("agent_id", id)
        .order("started_at", { ascending: false })
        .limit(10),
      supabase
        .from("agent_events")
        .select("id, event_type, message, payload, from_agent_id, to_agent_id, created_at")
        .eq("tenant_id", tenantId)
        .or(`from_agent_id.eq.${id},to_agent_id.eq.${id}`)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("findings")
        .select("id, type, payload, lead_id, project_id, created_at")
        .eq("tenant_id", tenantId)
        .eq("agent_id", id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (runsRes.error) throw runsRes.error;
    if (eventsRes.error) throw eventsRes.error;
    if (findingsRes.error) throw findingsRes.error;

    const runs = runsRes.data ?? [];
    const runIds = runs.map((r) => r.id as string);
    let toolCalls: unknown[] = [];
    if (runIds.length > 0) {
      const { data: toolCallRows, error: toolCallsError } = await supabase
        .from("tool_calls")
        .select("id, agent_run_id, tool_name, input, output, status, created_at")
        .eq("tenant_id", tenantId)
        .in("agent_run_id", runIds);
      if (toolCallsError) throw toolCallsError;
      toolCalls = toolCallRows ?? [];
    }

    let project: { id: string; name: string; status: string } | null = null;
    if (agent.current_project_id) {
      const { data } = await supabase
        .from("projects")
        .select("id, name, status")
        .eq("id", agent.current_project_id)
        .maybeSingle();
      project = (data as typeof project) ?? null;
    }

    let task: { id: string; title: string; status: string } | null = null;
    if (agent.current_task_id) {
      const { data } = await supabase.from("tasks").select("id, title, status").eq("id", agent.current_task_id).maybeSingle();
      task = (data as typeof task) ?? null;
    }

    return { agent, project, task, runs, events: eventsRes.data ?? [], toolCalls, findings: findingsRes.data ?? [] };
  });
}
