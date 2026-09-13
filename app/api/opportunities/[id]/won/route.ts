import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

/**
 * WON Gate entry point (spec §54): checks the minimum checklist and, only
 * if it passes, creates the `deal_won` CEO approval. The actual WON
 * confirmation is a separate human decision on that approval — this route
 * never marks anything WON by itself (spec §55).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));
    const clientIntentConfirmed = Boolean(body.clientIntentConfirmed);

    const { data: opp, error } = await supabase.from("opportunities").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!opp) throw new NotFoundError("Opportunity not found");

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "deal_won_gate_graph",
      subjectType: "opportunity",
      subjectId: id,
      input: { opportunityId: id, clientIntentConfirmed },
    });

    return { result: finalState };
  });
}
