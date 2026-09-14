/**
 * Email sending connector abstraction (spec §5-6, §12, §81-84).
 *
 * `SimulatedEmailConnector` never makes a network call, deterministically
 * fabricates provider ids, and follows the same honesty pattern as
 * `lib/ai/provider.ts`'s `TemplateProvider`. `GoogleGmailConnector` (Phase
 * 5, lib/integrations/googleGmailConnector.ts) is the real implementation
 * behind this exact same interface — `getEmailConnector()` below picks
 * between them, so no application code (lib/server/approvals.ts, the
 * outreach graphs, the Final Send Gate route) ever branches on which one it
 * got.
 *
 * The interface still enforces the real separation the spec requires:
 * `createDraft` (safe, no external effect) is a distinct call from `send`
 * (the one human-gated, idempotency-keyed external action).
 */
import type { SupabaseServerClient } from "@/lib/server/tenant";
import { loadConnection } from "@/lib/integrations/tokenStore";
import { GoogleGmailConnector } from "@/lib/integrations/googleGmailConnector";

export interface EmailDraftInput {
  to: string;
  subject: string;
  body: string;
}

export interface EmailDraftResult {
  provider: string;
  providerDraftId: string;
}

export interface EmailSendResult {
  provider: string;
  providerMessageId: string;
  providerThreadId: string;
  sentAt: string;
}

export interface EmailConnector {
  readonly provider: string;
  /** false = this connector never makes a real network call. */
  readonly isReal: boolean;
  createDraft(input: EmailDraftInput): Promise<EmailDraftResult>;
  send(input: EmailDraftInput, idempotencyKey: string): Promise<EmailSendResult>;
}

function seededId(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export class SimulatedEmailConnector implements EmailConnector {
  readonly provider = "simulated_gmail";
  readonly isReal = false;

  async createDraft(input: EmailDraftInput): Promise<EmailDraftResult> {
    return { provider: this.provider, providerDraftId: `draft_${seededId(input.to + input.subject)}` };
  }

  async send(input: EmailDraftInput, idempotencyKey: string): Promise<EmailSendResult> {
    return {
      provider: this.provider,
      providerMessageId: `msg_${seededId(idempotencyKey)}`,
      providerThreadId: `thread_${seededId(input.to)}`,
      sentAt: new Date().toISOString(),
    };
  }
}

/**
 * Returns a real GoogleGmailConnector only when the caller identifies a
 * specific tenant+user AND that user has a `connected` google
 * integration_connections row AND Google OAuth is actually configured in
 * this environment (`GOOGLE_OAUTH_CLIENT_ID` set) — every other case
 * (no ctx, not connected, not configured) safely falls back to the
 * Simulated connector, exactly like every pre-Phase-5 call site's behavior.
 * `ctx` is omitted by call sites that only need the connector for a
 * synchronous, no-network operation regardless of provider (e.g.
 * meetingScheduling.ts's slot proposal), and always provided by call sites
 * that might actually send/create something real (Final Send Gate,
 * decideApproval's sales_send/sales_reply draft creation).
 */
export async function getEmailConnector(ctx?: { supabase: SupabaseServerClient; tenantId: string; userId: string }): Promise<EmailConnector> {
  if (ctx && process.env.GOOGLE_OAUTH_CLIENT_ID) {
    const connection = await loadConnection(ctx.supabase, ctx.tenantId, ctx.userId, "google");
    if (connection && connection.status === "connected") {
      return new GoogleGmailConnector(ctx.supabase, connection);
    }
  }
  return new SimulatedEmailConnector();
}
