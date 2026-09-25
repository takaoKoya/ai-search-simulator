import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: project, error } = await supabase.from("projects").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!project) throw new NotFoundError("Project not found");

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "measurement_graph",
      subjectType: "project",
      subjectId: project.id as string,
      input: { projectId: project.id },
    });
    return { result: finalState };
  });
}
