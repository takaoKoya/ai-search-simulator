import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";

/**
 * Human Confirm (spec §21-26): a person reviews an AI-suggested Action Item
 * Candidate and, optionally, fills in owner/due date/priority themselves —
 * these are never AI-guessed (they stayed null on the CANDIDATE row), so
 * this route is the one place they get set, by a human, explicitly.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    const { supabase, tenantId } = ctx;

    const body = await request.json().catch(() => ({}));
    const owner = typeof body.owner === "string" && body.owner.trim() ? body.owner.trim() : null;
    const dueDate = typeof body.dueDate === "string" && body.dueDate.trim() ? body.dueDate.trim() : null;
    const priority = typeof body.priority === "string" ? body.priority : null;
    if (priority && !["LOW", "MEDIUM", "HIGH"].includes(priority)) {
      throw new ValidationError("priority must be one of LOW, MEDIUM, HIGH");
    }

    const { data: item, error } = await supabase.from("meeting_action_items").select("id, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!item) throw new NotFoundError("Action item not found");
    if (item.status !== "CANDIDATE") {
      throw new ValidationError(`Action item is not a pending candidate (status=${item.status})`);
    }

    const { error: updateError } = await supabase
      .from("meeting_action_items")
      .update({ status: "CONFIRMED", owner, due_date: dueDate, priority })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (updateError) throw updateError;

    return { confirmed: true };
  });
}
