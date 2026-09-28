import { createClient } from "@supabase/supabase-js";

// サーバー専用(Route Handler)からのみ import すること。
// RLSを迂回して全ユーザーのgos_ai_jobsキューを横断的に処理するために使う。
// Server Component / Server Action からユーザー自身のデータを操作する場合は
// 代わりに lib/supabase/server.ts の createClient() を使うこと。
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
