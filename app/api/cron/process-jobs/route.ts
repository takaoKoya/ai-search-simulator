import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { dequeueNextJob } from "@/lib/growth-os/db/jobs";
import { processJob } from "@/lib/growth-os/pipeline/processJob";

// Vercel Cron(または手動)から定期的に叩かれ、gos_ai_jobsキューを1リクエストにつき
// 数件だけ処理する。7Agent連鎖のような長い処理もこの分割実行によって
// サーバーレス関数のタイムアウトを回避する。認証はCRON_SECRETによる簡易ヘッダー検証。
const MAX_JOBS_PER_INVOCATION = 3;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const processed: string[] = [];

  for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
    const job = await dequeueNextJob(supabase);
    if (!job) break;

    await processJob(supabase, job);
    processed.push(job.id);
  }

  return NextResponse.json({ processed_count: processed.length, job_ids: processed });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
