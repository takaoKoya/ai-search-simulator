import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

/**
 * Starts the Sales Outreach Workflow (spec §3) for a lead that reached
 * READY_FOR_OUTREACH. Ends waiting on a `sales_send` CEO approval — this
 * route never sends anything itself.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: lead, error } = await supabase.from("leads").select("discovery_stage").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!lead) throw new ValidationError("Lead not found");
    if (lead.discovery_stage !== "READY_FOR_OUTREACH") {
      throw new ValidationError(`Lead is not READY_FOR_OUTREACH (current stage: ${lead.discovery_stage})`);
    }

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "sales_outreach_prep_graph",
      subjectType: "lead",
      subjectId: id,
      input: { leadId: id },
    });

    return { result: finalState };
  });
}
