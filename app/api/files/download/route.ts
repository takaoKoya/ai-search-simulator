import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { verifySignedFileToken } from "@/lib/server/fileSecurity";
import { decodeBytea } from "@/lib/server/bytea";

const CONTENT_TYPE: Record<string, string> = {
  PDF: "application/pdf",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Public signed-link redemption (spec §48) — the ONE route in this codebase
 * an external client (no Supabase Auth session, no tenant membership) can
 * reach. The HMAC-verified, short-lived token IS the security boundary
 * here, not RLS — which is exactly why this is one of the two documented,
 * narrow exceptions allowed to use the service-role client (see
 * lib/supabase/serviceRole.ts). A file is still re-checked for
 * classification=CLIENT_VISIBLE at redemption time (defense in depth: a
 * link issued while a file was shareable must not keep working if that
 * ever changes), and every redemption is logged with a null
 * performed_by_user_id — there is no human tenant user to attribute it to,
 * but the access itself is exactly what spec §49 requires auditing.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const verified = verifySignedFileToken(token);
  if (!verified.valid || !verified.fileId) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const { data: file, error } = await supabase.from("generated_files").select("id, tenant_id, file_type, file_data, storage_path, classification").eq("id", verified.fileId).maybeSingle();
  if (error || !file || file.classification !== "CLIENT_VISIBLE") {
    return NextResponse.json({ error: "File not found or no longer shareable" }, { status: 404 });
  }

  await supabase.from("file_access_logs").insert({
    tenant_id: file.tenant_id,
    file_id: file.id,
    action: "DOWNLOAD",
    performed_by_user_id: null,
  });

  const bytes = decodeBytea(file.file_data as string);
  const filename = (file.storage_path as string).split("/").pop() ?? "document";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPE[file.file_type as string] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
