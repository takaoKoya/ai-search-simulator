import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

const VALID_REACTIONS = ["PRICE_OBJECTION", "SCOPE_CHANGE", "TIMING_CHANGE", "COMPETITOR", "LEGAL_CONCERN", "PROCUREMENT", "APPROVED", "DECLINED"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));
    const reactionCategory = typeof body.reactionCategory === "string" ? body.reactionCategory : "";
    const note = typeof body.note === "string" ? body.note : undefined;
    if (!VALID_REACTIONS.includes(reactionCategory)) {
      throw new ValidationError(`reactionCategory must be one of: ${VALID_REACTIONS.join(", ")}`);
    }

    const { data: opp, error } = await supabase.from("opportunities").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!opp) throw new NotFoundError("Opportunity not found");

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "negotiation_analysis_graph",
      subjectType: "opportunity",
      subjectId: id,
      input: { opportunityId: id, reactionCategory, note },
    });

    return { result: finalState };
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const { data: opp, error } = await supabase.from("opportunities").select("lead_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!opp) throw new NotFoundError("Opportunity not found");
    const { data, error: findingsError } = await supabase
      .from("findings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("lead_id", opp.lead_id as string)
      .eq("type", "negotiation_item")
      .order("created_at", { ascending: false });
    if (findingsError) throw findingsError;
    return { items: (data ?? []).filter((f) => (f.payload as { opportunityId?: string })?.opportunityId === id) };
  });
}
