import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";

/**
 * Saves a meeting transcript (spec §29). No transcription service exists in
 * this sandbox — a human pastes in text (e.g. a test transcript for the
 * vertical slice, or one copied from an external transcription tool).
 * Transcript text is stored as-is; it is treated as UNTRUSTED_CONTENT by
 * `meeting_minutes_graph` (spec §87) — never as instructions to any agent.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (!transcript) throw new ValidationError("transcript is required");

    const { data: meeting, error } = await supabase.from("meetings").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!meeting) throw new NotFoundError("Meeting not found");

    await supabase.from("meetings").update({ transcript, transcript_status: "PROVIDED" }).eq("id", id).eq("tenant_id", tenantId);
    return { ok: true };
  });
}
