import { NextResponse } from "next/server";
import { z } from "zod";
import { ApplicantError, sendInterviewNotice } from "@/lib/applicants/service";
import { parseInterviewDate } from "@/lib/line/flow";

const bodySchema = z.object({
  template: z.string().trim().min(1, "メッセージを入力してください").max(5000),
  /** "YYYY-MM-DDTHH:mm" in JST (datetime-local value) */
  confirmedAt: z.string().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = bodySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: input.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  let confirmedAt: Date | null = null;
  if (input.data.confirmedAt) {
    confirmedAt = parseInterviewDate(input.data.confirmedAt);
    if (!confirmedAt) return NextResponse.json({ error: "面接日時の形式が不正です" }, { status: 400 });
  }

  try {
    const a = await sendInterviewNotice(id, { template: input.data.template, confirmedAt });
    return NextResponse.json({ id: a.id, status: a.status, notifiedAt: a.notifiedAt });
  } catch (e) {
    if (e instanceof ApplicantError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("notify failed", id, e);
    return NextResponse.json({ error: "送信に失敗しました" }, { status: 500 });
  }
}
