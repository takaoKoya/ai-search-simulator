import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/server/errors";
import { decodeBytea } from "@/lib/server/bytea";

/** Same status mapping as lib/server/withRoute.ts, adapted for a raw-bytes response instead of JSON. */
function errorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

const CONTENT_TYPE: Record<string, string> = {
  PDF: "application/pdf",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * In-app authenticated download (any tenant member, any classification) —
 * distinct from the external signed-link flow (/api/files/download +
 * /api/generated-files/[id]/share-link), which is the only path that may
 * ever leave this tenant's own users. Every download is audited (spec §49).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getTenantContext();
    const { supabase, tenantId, userId } = ctx;

    const { data: file, error } = await supabase
      .from("generated_files")
      .select("id, file_type, file_data, storage_path")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!file) throw new NotFoundError("File not found");

    await supabase.from("file_access_logs").insert({
      tenant_id: tenantId,
      file_id: id,
      action: "DOWNLOAD",
      performed_by_user_id: userId,
    });

    const bytes = decodeBytea(file.file_data as string);
    const filename = (file.storage_path as string).split("/").pop() ?? "document";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": CONTENT_TYPE[file.file_type as string] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
