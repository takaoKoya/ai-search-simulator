import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

/** Proposes candidate meeting times for an Opportunity (spec §22). Never confirms one itself. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: opp, error } = await supabase.from("opportunities").select("id, lead_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!opp) throw new NotFoundError("Opportunity not found");

    const { data: lead } = await supabase.from("leads").select("company_name").eq("id", opp.lead_id as string).eq("tenant_id", tenantId).maybeSingle();

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "meeting_scheduling_graph",
      subjectType: "opportunity",
      subjectId: id,
      input: { opportunityId: id, companyName: lead?.company_name ?? null },
    });

    return { result: finalState };
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const { data, error } = await supabase.from("meetings").select("*").eq("tenant_id", tenantId).eq("opportunity_id", id).order("created_at", { ascending: false });
    if (error) throw error;
    return { meetings: data ?? [] };
  });
}
