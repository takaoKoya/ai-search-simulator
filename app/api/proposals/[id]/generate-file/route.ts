import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { withRoute } from "@/lib/server/withRoute";
import { ValidationError } from "@/lib/server/errors";
import { generateProposalFile } from "@/lib/server/documentGeneration";

const VALID_FILE_TYPES = ["PDF", "PPTX"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoute(async () => {
    const { id } = await params;
    const ctx = await getTenantContext();

    const body = await request.json().catch(() => ({}));
    const fileType = body.fileType;
    if (!VALID_FILE_TYPES.includes(fileType)) {
      throw new ValidationError(`fileType must be one of: ${VALID_FILE_TYPES.join(", ")}`);
    }

    return generateProposalFile(ctx, id, fileType);
  });
}
