import { NextResponse } from "next/server";
import { generateJobContent, GenerationError } from "@/lib/jobs/generate";
import { generateJobInputSchema } from "@/lib/jobs/schema";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = generateJobInputSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: input.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }

  try {
    const result = await generateJobContent(input.data.text);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GenerationError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    console.error("jobs/generate failed", e);
    return NextResponse.json({ error: "求人原稿の生成に失敗しました" }, { status: 500 });
  }
}
