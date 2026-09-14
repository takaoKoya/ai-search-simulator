import { describe, expect, it } from "vitest";
import { buildFollowupDraft, computeFollowupRisk, shouldCreateFollowupCandidate } from "@/lib/sales/followupEngine";

describe("shouldCreateFollowupCandidate", () => {
  const BASE = { messageStatus: "SENT", businessDaysElapsed: 5, minBusinessDaysBeforeFollowup: 3, existingCandidateCount: 0, maxFollowups: 2 };

  it("returns true when all conditions are met", () => {
    expect(shouldCreateFollowupCandidate(BASE)).toBe(true);
  });

  it("never follows up on a message that was not actually sent", () => {
    expect(shouldCreateFollowupCandidate({ ...BASE, messageStatus: "DRAFT" })).toBe(false);
    expect(shouldCreateFollowupCandidate({ ...BASE, messageStatus: "FAILED" })).toBe(false);
  });

  it("waits until the minimum business-day threshold has passed", () => {
    expect(shouldCreateFollowupCandidate({ ...BASE, businessDaysElapsed: 2 })).toBe(false);
    expect(shouldCreateFollowupCandidate({ ...BASE, businessDaysElapsed: 3 })).toBe(true);
  });

  it("stops once the max follow-up count is reached", () => {
    expect(shouldCreateFollowupCandidate({ ...BASE, existingCandidateCount: 2, maxFollowups: 2 })).toBe(false);
  });
});

describe("computeFollowupRisk", () => {
  it("escalates with elapsed business days", () => {
    expect(computeFollowupRisk(1)).toBe("LOW");
    expect(computeFollowupRisk(5)).toBe("MEDIUM");
    expect(computeFollowupRisk(10)).toBe("HIGH");
  });
});

describe("buildFollowupDraft", () => {
  it("addresses the named recipient when known", () => {
    const draft = buildFollowupDraft({ companyName: "テスト株式会社", recipientName: "山田様", originalSubject: "ご提案", sequenceNumber: 1 });
    expect(draft.body).toContain("山田様");
  });

  it("falls back to a company-level greeting when no recipient name is known (never guesses a name)", () => {
    const draft = buildFollowupDraft({ companyName: "テスト株式会社", recipientName: null, originalSubject: "ご提案", sequenceNumber: 1 });
    expect(draft.body).toContain("テスト株式会社 ご担当者様");
  });

  it("prefixes the subject with Re: only when not already present", () => {
    expect(buildFollowupDraft({ companyName: "x", originalSubject: "ご提案", sequenceNumber: 1 }).subject).toBe("Re: ご提案");
    expect(buildFollowupDraft({ companyName: "x", originalSubject: "Re: ご提案", sequenceNumber: 1 }).subject).toBe("Re: ご提案");
  });
});
