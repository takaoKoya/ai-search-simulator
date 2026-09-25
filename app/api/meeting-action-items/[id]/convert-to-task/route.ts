import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";

/**
 * "Convert to Project Task" (spec §25): Action Items stay Opportunity-level
 * until a real Project exists — `tasks.project_id` is NOT NULL, and no
 * Project exists before WON -> Contract -> Onboarding creates one (see
 * README "known limitations", carried over unchanged from Phase 4). This
 * route is the explicit, human-triggered action that only becomes possible
 * once that chain has actually produced a Project, and it must be run on a
 * CONFIRMED item (never a raw CANDIDATE) — full traceability is
 * `meeting_action_items.task_id` pointing at the created row.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    const { supabase, tenantId } = ctx;

    const { data: item, error } = await supabase
      .from("meeting_action_items")
      .select("id, status, description, owner, due_date, priority, opportunity_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!item) throw new NotFoundError("Action item not found");
    if (item.status !== "CONFIRMED") {
      throw new ValidationError(`Action item must be Human-Confirmed before it can become a Task (status=${item.status})`);
    }
    if (!item.opportunity_id) {
      throw new ValidationError("Action item has no linked Opportunity");
    }

    const { data: contract } = await supabase
      .from("contracts")
      .select("id")
      .eq("opportunity_id", item.opportunity_id as string)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const project = contract
      ? (await supabase.from("projects").select("id").eq("contract_id", contract.id as string).eq("tenant_id", tenantId).maybeSingle()).data
      : null;
    if (!project) {
      throw new ValidationError("No Project exists yet for this Opportunity (WON -> Contract -> Onboarding must complete first).");
    }

    const description = [item.owner ? `担当: ${item.owner}` : null, item.due_date ? `期限: ${item.due_date}` : null, "", item.description as string]
      .filter((line) => line !== null)
      .join("\n");

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        tenant_id: tenantId,
        project_id: project.id as string,
        title: (item.description as string).slice(0, 200),
        description,
      })
      .select("id")
      .single();
    if (taskError || !task) throw taskError ?? new Error("Failed to create task");

    const { error: updateError } = await supabase
      .from("meeting_action_items")
      .update({ status: "CONVERTED_TO_TASK", task_id: task.id })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (updateError) throw updateError;

    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "meeting_action_item.converted_to_task",
      message: `商談Action ItemをProject Taskに変換しました`,
      payload: { actionItemId: id, taskId: task.id, projectId: project.id },
    });

    return { taskId: task.id, projectId: project.id };
  });
}
