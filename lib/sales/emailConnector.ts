/**
 * Email sending connector abstraction (spec §5-6, §12, §81-84).
 *
 * No real Gmail/OAuth integration exists anywhere in this repository (there
 * is no `googleapis`/`nodemailer`/OAuth client code at all — confirmed by
 * repo-wide search before writing this file). Building a "fake" connector
 * that pretends to call Gmail would risk exactly what the product brief
 * prohibits: an unconfirmed external send. Instead this follows the same
 * honesty pattern as `lib/ai/provider.ts`'s `TemplateProvider` and
 * `lib/sales/candidateSource.ts`'s test fixtures — `SimulatedEmailConnector`
 * never makes a network call, deterministically fabricates provider ids, and
 * is the only implementation today. Wiring a real Gmail OAuth connector
 * behind this same `EmailConnector` interface is a documented Phase 5 item.
 *
 * The interface still enforces the real separation the spec requires:
 * `createDraft` (safe, no external effect) is a distinct call from `send`
 * (the one human-gated, idempotency-keyed external action).
 */

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

export function getEmailConnector(): EmailConnector {
  return new SimulatedEmailConnector();
}
