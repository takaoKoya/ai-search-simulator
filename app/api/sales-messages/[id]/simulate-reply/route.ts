import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { runBusinessGraph } from "@/lib/langgraph/orchestrator";

/**
 * Test-mode reply ingestion (spec §95-96): there is no real Gmail inbox to
 * poll in this repository, so a human pastes in a test reply for a message
 * that was actually sent. Restricted to `test_mode` messages only — this
 * can never be used to fabricate a "reply" against a real outreach.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const { supabase, tenantId } = await getTenantContext();
    const body = await request.json().catch(() => ({}));
    const replyText = typeof body.replyText === "string" ? body.replyText.trim() : "";
    if (!replyText) throw new ValidationError("replyText is required");

    const { data: message, error } = await supabase
      .from("sales_messages")
      .select("id, status, test_mode, direction")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!message) throw new ValidationError("Message not found");
    if (message.direction !== "OUTBOUND") throw new ValidationError("Can only simulate a reply to an OUTBOUND message");
    if (message.status !== "SENT" && message.status !== "REPLIED") {
      throw new ValidationError(`Message must be SENT before a reply can be simulated (status=${message.status})`);
    }
    if (!message.test_mode) {
      throw new ValidationError("simulate-reply is only available for test_mode messages");
    }

    const finalState = await runBusinessGraph({
      supabase,
      tenantId,
      graphName: "reply_analysis_graph",
      subjectType: "sales_message",
      subjectId: id,
      input: { originalMessageId: id, replyText },
    });

    return { result: finalState };
  });
}
