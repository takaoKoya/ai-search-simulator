import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: opp, error } = await supabase.from("opportunities").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!opp) throw new NotFoundError("Opportunity not found");

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "proposal_draft_graph",
      subjectType: "opportunity",
      subjectId: id,
      input: { opportunityId: id },
    });

    return { result: finalState };
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const { data, error } = await supabase.from("proposals").select("*").eq("tenant_id", tenantId).eq("opportunity_id", id).order("created_at", { ascending: false });
    if (error) throw error;
    return { proposals: data ?? [] };
  });
}
