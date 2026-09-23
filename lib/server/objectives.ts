import type { SupabaseServerClient } from "@/lib/server/tenant";
import { NotFoundError } from "@/lib/server/errors";
import type { ObjectiveStatus } from "@/lib/autonomy/types";

export interface ObjectiveRow {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  objective_type: string;
  target_value: number | null;
  current_value: number | null;
  unit: string | null;
  start_date: string | null;
  deadline: string | null;
  priority: string;
  status: ObjectiveStatus;
  owner_type: string;
  owner_id: string | null;
  created_by: string | null;
  /** Optional link to an existing `projects` row — see lib/autonomy/executionAdapter.ts, which needs it to invoke project-scoped Skills (measurement_graph/renewal_graph). Most Company Objectives are not project-scoped, so this is usually null. */
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function createObjective(
  supabase: SupabaseServerClient,
  tenantId: string,
  params: {
    title: string;
    description?: string;
    objectiveType?: "kpi_target" | "initiative" | "other";
    targetValue?: number;
    unit?: string;
    deadline?: string;
    priority?: "low" | "medium" | "high" | "critical";
    createdBy?: string;
    projectId?: string;
  }
): Promise<ObjectiveRow> {
  const { data, error } = await supabase
    .from("objectives")
    .insert({
      tenant_id: tenantId,
      title: params.title,
      description: params.description ?? null,
      objective_type: params.objectiveType ?? "kpi_target",
      target_value: params.targetValue ?? null,
      unit: params.unit ?? null,
      deadline: params.deadline ?? null,
      priority: params.priority ?? "medium",
      status: "DRAFT",
      created_by: params.createdBy ?? null,
      project_id: params.projectId ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create objective");
  const objective = data as ObjectiveRow;

  await supabase.from("agent_events").insert({
    tenant_id: tenantId,
    event_type: "objective.created",
    message: `Objective作成: ${objective.title}`,
    payload: { objectiveId: objective.id },
  });

  return objective;
}

export async function listObjectives(supabase: SupabaseServerClient, tenantId: string, params?: { status?: ObjectiveStatus }): Promise<ObjectiveRow[]> {
  let query = supabase.from("objectives").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (params?.status) query = query.eq("status", params.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ObjectiveRow[];
}

export async function getObjective(supabase: SupabaseServerClient, tenantId: string, objectiveId: string): Promise<ObjectiveRow> {
  const { data, error } = await supabase.from("objectives").select("*").eq("id", objectiveId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError(`objective ${objectiveId} not found`);
  return data as ObjectiveRow;
}

/** ACTIVE/ACHIEVED/etc — a plain status write, distinct from Autonomy Cycle/Work transitions (objectives are not part of the transitionCycle/transitionWork whitelist; they are Observer/Supervisor-maintained business state, not a runtime execution state machine). */
export async function updateObjectiveStatus(supabase: SupabaseServerClient, tenantId: string, objectiveId: string, status: ObjectiveStatus, currentValue?: number): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (currentValue !== undefined) patch.current_value = currentValue;
  const { error } = await supabase.from("objectives").update(patch).eq("id", objectiveId).eq("tenant_id", tenantId);
  if (error) throw error;
}
