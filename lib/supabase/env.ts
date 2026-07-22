// Next.jsはNEXT_PUBLIC_*の環境変数をクライアントバンドルへ静的に埋め込むため、
// `process.env.NEXT_PUBLIC_X` のようにリテラルでアクセスする必要がある。
// `process.env[name]` のような動的アクセスは埋め込み対象として認識されず、
// ブラウザ上では常にundefinedになるため避けること。
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!anonKey) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return { url, anonKey };
}
