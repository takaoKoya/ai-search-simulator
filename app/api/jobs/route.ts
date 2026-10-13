import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { saveJobInputSchema } from "@/lib/jobs/schema";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = saveJobInputSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: input.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }

  const { rawInput, job } = input.data;
  try {
    const saved = await prisma.job.create({
      data: {
        rawInput,
        title: job.title,
        location: job.location,
        salary: job.salary,
        conditions: job.conditions,
        targetType: job.targetType,
        snsPostText: job.snsPostText,
        indeedText: job.indeedText,
        lineQuestions: job.lineQuestions,
      },
      select: { id: true },
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (e) {
    console.error("jobs save failed", e);
    return NextResponse.json({ error: "求人の保存に失敗しました" }, { status: 500 });
  }
}
