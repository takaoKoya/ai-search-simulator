import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { templateInputSchema } from "@/lib/templates/schema";

/** GET /api/templates?jobId= → shared templates plus that job's own. */
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  const templates = await prisma.messageTemplate.findMany({
    where: { OR: [{ jobId: null }, ...(jobId ? [{ jobId }] : [])] },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const input = templateInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: input.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const { name, body, jobId } = input.data;
  if (jobId && !(await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } }))) {
    return NextResponse.json({ error: "求人が見つかりません" }, { status: 404 });
  }
  const template = await prisma.messageTemplate.create({ data: { name, body, jobId: jobId ?? null } });
  return NextResponse.json(template, { status: 201 });
}
