import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { generateSignedFileToken } from "@/lib/server/fileSecurity";

/**
 * Issues a short-lived (5-30 min) signed download link (spec §48) — never a
 * permanent public URL. Only ever allowed on a CLIENT_VISIBLE file: a DRAFT
 * (internal-only) document can never be shared externally through this
 * route, no matter who asks.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();
    const { supabase, tenantId, userId } = ctx;

    const { data: file, error } = await supabase.from("generated_files").select("id, classification").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    if (!file) throw new NotFoundError("File not found");
    if (file.classification !== "CLIENT_VISIBLE") {
      throw new ValidationError(`Only CLIENT_VISIBLE files can be shared externally (this file is ${file.classification})`);
    }

    const body = await request.json().catch(() => ({}));
    const ttlSeconds = typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined;
    const { token, expiresAt } = generateSignedFileToken(id, ttlSeconds);

    await supabase.from("file_access_logs").insert({
      tenant_id: tenantId,
      file_id: id,
      action: "SHARE_LINK_CREATED",
      performed_by_user_id: userId,
    });

    const url = new URL("/api/files/download", request.url);
    url.searchParams.set("token", token);
    return { url: url.toString(), expiresAt };
  });
}
