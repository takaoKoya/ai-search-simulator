import type { TenantContext } from "@/lib/server/tenant";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { computeSnapshotHash } from "@/lib/server/approvalSnapshot";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

export type DeliveryChannel = "email" | "meeting" | "portal" | "other";

/**
 * READY_FOR_DELIVERY -> DELIVERED (Growth Loop spec §2-4): the explicit
 * Human Action that actually hands the work to the client. Distinct from the
 * internal "delivery" approval_request (which only reaches
 * `projects.status = 'ready_for_delivery'`, see lib/langgraph/graphs/delivery.ts) —
 * a CEO approving internally is not the same event as a human actually
 * sending/presenting the deliverables.
 */
export async function confirmProjectDelivery(
  ctx: TenantContext,
  projectId: string,
  params: { deliveryChannel: DeliveryChannel; recipient?: string | null; notes?: string | null }
): Promise<{ deliveryRecordId: string }> {
  const { supabase, tenantId, userId } = ctx;

  const { data: project, error } = await supabase.from("projects").select("id, status, client_id").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!project) throw new NotFoundError("Project not found");
  if (project.status !== "ready_for_delivery") {
    throw new ValidationError(`Project must be READY_FOR_DELIVERY before it can be marked DELIVERED (status=${project.status})`);
  }

  const { data: deliverables } = await supabase.from("deliverables").select("id").eq("project_id", projectId).eq("tenant_id", tenantId).eq("status", "approved");
  const deliverableIds = (deliverables ?? []).map((d) => d.id as string);

  const snapshotHash = computeSnapshotHash({ projectId, deliverableIds });

  const { data: record, error: insertError } = await supabase
    .from("delivery_records")
    .insert({
      tenant_id: tenantId,
      client_id: project.client_id,
      project_id: projectId,
      deliverable_ids: deliverableIds,
      delivered_by: userId,
      delivery_channel: params.deliveryChannel,
      recipient: params.recipient ?? null,
      snapshot_hash: snapshotHash,
      notes: params.notes ?? null,
    })
    .select("id")
    .single();
  if (insertError || !record) throw insertError ?? new Error("Failed to create delivery record");

  await supabase.from("projects").update({ status: "delivered" }).eq("id", projectId).eq("tenant_id", tenantId);
  await supabase.from("deliverables").update({ status: "delivered" }).eq("project_id", projectId).eq("tenant_id", tenantId).eq("status", "approved");

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: "delivery.confirmed",
    message: "納品が完了しました(DELIVERED)",
    payload: { deliveryRecordId: record.id, projectId, deliveryChannel: params.deliveryChannel },
  });

  // Measurement Trigger (spec §4): the Growth Loop starts the moment
  // delivery is confirmed — measurement_graph itself decides per-KPI when
  // evaluation is actually allowed to happen (baseline now, evaluate later).
  await runBusinessGraph({
    supabase,
    tenantId,
    graphName: "measurement_graph",
    subjectType: "project",
    subjectId: projectId,
    input: { projectId },
  });

  return { deliveryRecordId: record.id as string };
}
