import { NextResponse } from "next/server";
import { ApplicantError, scoreAndSave } from "@/lib/applicants/service";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const a = await scoreAndSave(id);
    return NextResponse.json({ id: a.id, score: a.score, evaluation: a.evaluation, status: a.status });
  } catch (e) {
    if (e instanceof ApplicantError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("rescore failed", id, e);
    return NextResponse.json({ error: "AIスコアの再実行に失敗しました" }, { status: 502 });
  }
}
