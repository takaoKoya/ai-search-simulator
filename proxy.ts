import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { LOGIN_ROUTE } from "@/lib/routes";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // config.matcher below already scopes this proxy to /home and /task,
  // so every request reaching here is on a protected path.
  if (!user) {
    return NextResponse.redirect(new URL(LOGIN_ROUTE, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/home/:path*", "/task/:path*"],
};
