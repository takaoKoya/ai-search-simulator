import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";

/**
 * A human dismisses an Action Item Candidate (e.g. a false-positive match
 * from the transcript keyword scan, or a duplicate the AI's simple
 * substring check missed). Distinct from CONVERTED_TO_TASK — rejection is
 * final for this candidate, never auto-deleted.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    const { supabase, tenantId } = ctx;

    const { data: item, error } = await supabase.from("meeting_action_items").select("id, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!item) throw new NotFoundError("Action item not found");
    if (item.status !== "CANDIDATE") {
      throw new ValidationError(`Action item is not a pending candidate (status=${item.status})`);
    }

    const { error: updateError } = await supabase.from("meeting_action_items").update({ status: "REJECTED" }).eq("id", id).eq("tenant_id", tenantId);
    if (updateError) throw updateError;

    return { rejected: true };
  });
}
