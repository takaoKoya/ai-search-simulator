/**
 * Follow-up Engine (spec §67-71): produces ONLY human-approvable Candidates
 * — "自動送信しない" (never auto-send) applies without exception here.
 * Nothing in this module ever calls an EmailConnector or touches
 * sales_messages.status; it only decides whether a candidate is worth
 * creating and drafts its content.
 */

export interface FollowupCandidateDraft {
  subject: string;
  body: string;
}

export function shouldCreateFollowupCandidate(params: {
  messageStatus: string; // the original outbound message's status
  businessDaysElapsed: number;
  minBusinessDaysBeforeFollowup: number;
  existingCandidateCount: number;
  maxFollowups: number;
}): boolean {
  if (params.messageStatus !== "SENT") return false; // never follow up on a message that never actually sent
  if (params.businessDaysElapsed < params.minBusinessDaysBeforeFollowup) return false;
  if (params.existingCandidateCount >= params.maxFollowups) return false;
  return true;
}

/** A simple, deterministic elapsed-time heuristic — never a guess about the lead's actual intent. */
export function computeFollowupRisk(businessDaysElapsed: number): "LOW" | "MEDIUM" | "HIGH" {
  if (businessDaysElapsed >= 10) return "HIGH";
  if (businessDaysElapsed >= 5) return "MEDIUM";
  return "LOW";
}

export function buildFollowupDraft(params: { companyName: string; recipientName?: string | null; originalSubject: string; sequenceNumber: number }): FollowupCandidateDraft {
  const greeting = params.recipientName ? `${params.recipientName}様` : `${params.companyName} ご担当者様`;
  const subject = params.originalSubject.startsWith("Re:") ? params.originalSubject : `Re: ${params.originalSubject}`;
  const body = [
    greeting,
    "",
    "先日ご連絡させていただいた件、その後のご検討状況はいかがでしょうか。",
    "ご不明点やご要望などございましたら、お気軽にお知らせいただけますと幸いです。",
    "",
    "何卒よろしくお願いいたします。",
  ].join("\n");
  return { subject, body };
}
