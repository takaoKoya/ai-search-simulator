import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/lib/server/tenant";
import { consumeOAuthState, exchangeCodeForTokens } from "@/lib/integrations/oauth";
import { fetchWithRetry } from "@/lib/integrations/httpRetry";
import { saveConnectionTokens } from "@/lib/integrations/tokenStore";
import { LOGIN_ROUTE } from "@/lib/routes";

const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * OAuth callback (spec §6-9). CSRF defense: `state` is verified against the
 * server-side `oauth_states` row this tenant+user actually created
 * (consumeOAuthState) — never trusted from the query string alone, and
 * single-use (a replayed callback fails). Never logs `code`, the exchanged
 * tokens, or the raw callback query string.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL("/office?google=denied", request.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/office?google=error", request.url));
  }

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    return NextResponse.redirect(new URL(LOGIN_ROUTE, request.url));
  }

  try {
    const stateRow = await consumeOAuthState(ctx.supabase, { state, tenantId: ctx.tenantId, userId: ctx.userId, provider: "google" });

    const tokens = await exchangeCodeForTokens({ code, codeVerifier: stateRow.code_verifier, redirectUri: stateRow.redirect_uri });

    let connectedEmail: string | null = null;
    const userinfoRes = await fetchWithRetry(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (userinfoRes.ok) {
      const userinfo = (await userinfoRes.json()) as { email?: string };
      connectedEmail = userinfo.email ?? null;
    }

    await saveConnectionTokens(ctx.supabase, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      provider: "google",
      tokens,
      connectedEmail,
      scopes: stateRow.scopes,
    });

    await ctx.supabase.from("agent_events").insert({
      tenant_id: ctx.tenantId,
      event_type: "integration.google_connected",
      message: connectedEmail ? `Googleアカウント（${connectedEmail}）を接続しました` : "Googleアカウントを接続しました",
      payload: { provider: "google" },
    });

    return NextResponse.redirect(new URL("/office?google=connected", request.url));
  } catch (err) {
    console.error("Google OAuth callback failed", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL("/office?google=error", request.url));
  }
}
