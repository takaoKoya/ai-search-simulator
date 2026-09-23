import type { NextRequest } from "next/server";
import { APPROVER_ROLES, assertRole, getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";

/**
 * The Kill Switch toggle (spec §11) — "a single, immediately-effective
 * toggle a human can flip without a deploy." Restricted to APPROVER_ROLES
 * (owner/ceo/admin), same bar as every other tenant-wide safety control in
 * this codebase — never a plain member action.
 */
export async function POST(request: NextRequest) {
  return withRoute(async () => {
    const ctx = await getTenantContext();
    assertRole(ctx, APPROVER_ROLES);
    const { supabase, tenantId, userId } = ctx;

    const body = await request.json().catch(() => ({}));
    if (typeof body.emergencyStop !== "boolean") {
      throw new ValidationError("emergencyStop must be a boolean");
    }

    const { error } = await supabase.from("tenant_autonomy_settings").update({ emergency_stop: body.emergencyStop }).eq("tenant_id", tenantId);
    if (error) throw error;

    await supabase.from("agent_events").insert({
      tenant_id: tenantId,
      event_type: "autonomy.emergency_stop_toggled",
      message: body.emergencyStop ? "Emergency Stopを有効化" : "Emergency Stopを解除",
      payload: { emergencyStop: body.emergencyStop, byUserId: userId },
    });

    return { ok: true, emergencyStop: body.emergencyStop as boolean };
  });
}
