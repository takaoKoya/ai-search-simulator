import { NextResponse } from "next/server";
import { ApplicantError, syncProfile } from "@/lib/applicants/service";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const a = await syncProfile(id);
    return NextResponse.json({ id: a.id, lineDisplayName: a.lineDisplayName, linePictureUrl: a.linePictureUrl });
  } catch (e) {
    if (e instanceof ApplicantError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("sync-profile failed", id, e);
    return NextResponse.json({ error: "プロフィールの更新に失敗しました" }, { status: 500 });
  }
}
