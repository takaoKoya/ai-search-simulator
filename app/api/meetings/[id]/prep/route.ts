import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: meeting, error } = await supabase.from("meetings").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!meeting) throw new NotFoundError("Meeting not found");

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "meeting_prep_graph",
      subjectType: "meeting",
      subjectId: id,
      input: { meetingId: id },
    });

    return { result: finalState };
  });
}
