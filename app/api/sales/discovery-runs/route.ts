import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";
import { ManualCandidateSource, TestFixtureCandidateSource } from "@/lib/sales/candidateSource";

/**
 * Starts one Sales Discovery Run (spec §7) for a single candidate — the
 * vertical slice from §81. No real search/directory API is called (see
 * lib/sales/candidateSource.ts); the candidate is either supplied directly
 * (manual) or one of three labeled synthetic fixtures (test_mode).
 */
export async function POST(request: NextRequest) {
  return withRoute(async () => {
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));

    let icpProfileId = typeof body.icpProfileId === "string" ? body.icpProfileId : undefined;
    if (!icpProfileId) {
      const { data: defaultIcp } = await supabase
        .from("icp_profiles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_default", true)
        .maybeSingle();
      icpProfileId = defaultIcp?.id as string | undefined;
    }
    if (!icpProfileId) {
      throw new ValidationError("No ICP profile configured for this tenant. Create one in ICP Settings first.");
    }

    const source =
      body.source === "test_fixture"
        ? new TestFixtureCandidateSource((body.scenario as "A" | "B" | "C") ?? "A")
        : new ManualCandidateSource({
            companyName: typeof body.candidate?.companyName === "string" ? body.candidate.companyName : "",
            domain: body.candidate?.domain ?? null,
            websiteUrl: body.candidate?.websiteUrl ?? null,
            industry: body.candidate?.industry ?? null,
            region: body.candidate?.region ?? null,
          });

    const [candidate] = await source.discover(1);
    if (!candidate || !candidate.companyName) {
      throw new ValidationError("A candidate company name is required (or pass source: 'test_fixture')");
    }

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "lead_discovery_graph",
      subjectType: "icp_profile",
      subjectId: icpProfileId,
      input: { icpProfileId, candidate },
    });

    return { result: finalState };
  });
}
