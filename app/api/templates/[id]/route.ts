import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { templateUpdateSchema } from "@/lib/templates/schema";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = templateUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: input.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  try {
    return NextResponse.json(await prisma.messageTemplate.update({ where: { id }, data: input.data }));
  } catch {
    return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await prisma.messageTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "テンプレートが見つかりません" }, { status: 404 });
  }
}
