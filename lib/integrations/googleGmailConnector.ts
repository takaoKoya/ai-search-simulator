import type { SupabaseServerClient } from "@/lib/server/tenant";
import { fetchWithRetry } from "@/lib/integrations/httpRetry";
import { getValidAccessToken, type IntegrationConnectionRow } from "@/lib/integrations/tokenStore";
import type { EmailConnector, EmailDraftInput, EmailDraftResult, EmailSendResult } from "@/lib/sales/emailConnector";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047-encodes non-ASCII header values — Japanese subjects are the norm in this app and must not be sent as raw UTF-8 in a header. */
function encodeHeaderValue(value: string): string {
  const isAscii = Array.from(value).every((ch) => ch.charCodeAt(0) < 128);
  if (isAscii) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildRawMessage(input: EmailDraftInput): string {
  const message = [`To: ${input.to}`, `Subject: ${encodeHeaderValue(input.subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", input.body].join("\r\n");
  return base64url(message);
}

/**
 * Real Gmail connector (spec §5-12) behind the exact same EmailConnector
 * interface SimulatedEmailConnector uses — application code
 * (lib/server/approvals.ts, the outreach graphs, the Final Send Gate route)
 * never branches on which one it got. Constructed only when a tenant/user
 * actually has a `connected` google integration_connections row; the
 * factory (getEmailConnector in lib/sales/emailConnector.ts) falls back to
 * SimulatedEmailConnector whenever that is not the case, so this class can
 * assume a connection exists.
 */
export class GoogleGmailConnector implements EmailConnector {
  readonly provider = "google_gmail";
  readonly isReal = true;

  constructor(
    private readonly supabase: SupabaseServerClient,
    private readonly connection: IntegrationConnectionRow
  ) {}

  private async authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const accessToken = await getValidAccessToken(this.supabase, this.connection);
    return fetchWithRetry(`${GMAIL_API_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
  }

  async createDraft(input: EmailDraftInput): Promise<EmailDraftResult> {
    const res = await this.authorizedFetch("/drafts", { method: "POST", body: JSON.stringify({ message: { raw: buildRawMessage(input) } }) });
    if (!res.ok) throw new Error(`Gmail createDraft failed: ${res.status}`);
    const data = (await res.json()) as { id: string };
    return { provider: this.provider, providerDraftId: data.id };
  }

  /**
   * Sends via messages.send rather than drafts.send: the EmailConnector
   * interface (fixed since Phase 4, never broken by this phase) takes the
   * message content directly, not a draft id, so this composes a fresh raw
   * message from exactly the approved `input` — the same content the
   * Approval Snapshot Hash (lib/server/approvals.ts) verifies is unchanged
   * since approval. Idempotency against a double-click is enforced one
   * layer up, by the Final Send Gate route's atomic
   * `status = 'READY_TO_SEND'` conditional update — not here.
   */
  async send(input: EmailDraftInput, _idempotencyKey: string): Promise<EmailSendResult> {
    const res = await this.authorizedFetch("/messages/send", { method: "POST", body: JSON.stringify({ raw: buildRawMessage(input) }) });
    if (!res.ok) throw new Error(`Gmail send failed: ${res.status}`);
    const data = (await res.json()) as { id: string; threadId: string };
    return { provider: this.provider, providerMessageId: data.id, providerThreadId: data.threadId, sentAt: new Date().toISOString() };
  }
}
