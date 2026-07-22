import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HOME_ROUTE, LOGIN_ROUTE } from "@/lib/routes";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${HOME_ROUTE}`);
    }
  }

  return NextResponse.redirect(`${origin}${LOGIN_ROUTE}?error=auth`);
}
