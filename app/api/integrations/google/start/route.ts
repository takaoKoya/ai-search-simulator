import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { createOAuthState, GOOGLE_OAUTH_SCOPES } from "@/lib/integrations/oauth";
import { LOGIN_ROUTE } from "@/lib/routes";

/**
 * Starts the Google Authorization Code Flow (spec §5-6). This is a
 * top-level browser navigation (an <a href> / window.location, never a
 * fetch()), so it returns HTTP redirects rather than JSON — withRoute is
 * not used here for that reason. The PKCE verifier + single-use state are
 * generated and stored server-side by createOAuthState(); nothing
 * client-supplied is trusted until the callback re-verifies it.
 */
export async function GET(request: NextRequest) {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
    return NextResponse.redirect(new URL("/office?google=not_configured", request.url));
  }

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    return NextResponse.redirect(new URL(LOGIN_ROUTE, request.url));
  }

  const redirectUri = new URL("/api/integrations/google/callback", request.url).toString();

  try {
    const { authUrl } = await createOAuthState(ctx.supabase, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      provider: "google",
      scopes: GOOGLE_OAUTH_SCOPES,
      redirectUri,
    });
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("Failed to start Google OAuth flow", err);
    return NextResponse.redirect(new URL("/office?google=error", request.url));
  }
}
