import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_ROUTE, POST_LOGIN_ROUTE } from "@/lib/routes";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${POST_LOGIN_ROUTE}`);
    }
  }

  return NextResponse.redirect(`${origin}${LOGIN_ROUTE}?error=auth`);
}
