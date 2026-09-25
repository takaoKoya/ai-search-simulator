import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();

    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, company_name, industry, status")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!lead) throw new NotFoundError("Lead not found");
    if (lead.status !== "new") {
      throw new ValidationError(`Lead is already past the "new" stage (status=${lead.status})`);
    }

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "lead_generation_graph",
      subjectType: "lead",
      subjectId: lead.id as string,
      input: { leadId: lead.id, companyName: lead.company_name, industry: lead.industry ?? "" },
    });

    return { result: finalState };
  });
}
