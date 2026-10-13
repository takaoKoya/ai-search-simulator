import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const patchSchema = z.object({ status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]) });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = patchSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  try {
    const job = await prisma.job.update({ where: { id }, data: input.data, select: { id: true, status: true } });
    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: "求人が見つかりません" }, { status: 404 });
  }
}
