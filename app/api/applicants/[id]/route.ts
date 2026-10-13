import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["NEW", "SCREENING", "PENDING", "PASSED", "REJECTED", "INTERVIEW_SCHEDULED", "HIRED"]),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = patchSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });

  try {
    // statusManual stops later AI re-scoring from overwriting a person's decision
    const applicant = await prisma.applicant.update({
      where: { id },
      data: { status: input.data.status, statusManual: true },
      select: { id: true, status: true },
    });
    return NextResponse.json(applicant);
  } catch {
    return NextResponse.json({ error: "応募者が見つかりません" }, { status: 404 });
  }
}
