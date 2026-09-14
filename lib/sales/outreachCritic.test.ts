import { describe, expect, it } from "vitest";
import { checkOutreachDraft, type OutreachDraftForReview } from "@/lib/sales/outreachCritic";

const baseDraft: OutreachDraftForReview = {
  subject: "株式会社サンプル様へ：SEOに関するご相談",
  personalizedObservation: "貴社のWebサイトを拝見し、更新が滞っている点に着目いたしました。",
  problemHypothesis: "SEO対策が不十分です。",
  valueProposition: "弊社ではSEOを中心にご支援しております。",
  evidence: [{ sourceUrl: "https://example.jp", capturedAt: "2026-09-01", evidence: "更新停滞" }],
  cta: "15分ほどお時間をいただけますでしょうか。",
  body: "本文です。".repeat(5),
};
const okCtx = { isDuplicateRecent: false, isDoNotContact: false };

describe("checkOutreachDraft", () => {
  it("passes a well-formed draft", () => {
    const result = checkOutreachDraft(baseDraft, okCtx);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("blocks a Do Not Contact match regardless of draft quality", () => {
    const result = checkOutreachDraft(baseDraft, { ...okCtx, isDoNotContact: true });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.startsWith("DNC:"))).toBe(true);
  });

  it("flags a duplicate outreach attempt", () => {
    const result = checkOutreachDraft(baseDraft, { ...okCtx, isDuplicateRecent: true });
    expect(result.issues.some((i) => i.startsWith("DUPLICATE_OUTREACH:"))).toBe(true);
  });

  it("flags exaggerated/guaranteed-result claims", () => {
    const result = checkOutreachDraft({ ...baseDraft, valueProposition: "導入すれば100%成果が確実に出ます。" }, okCtx);
    expect(result.issues.some((i) => i.startsWith("CLAIM_RISK:"))).toBe(true);
  });

  it("flags missing evidence as a personalization failure", () => {
    const result = checkOutreachDraft({ ...baseDraft, evidence: [] }, okCtx);
    expect(result.issues.some((i) => i.startsWith("PERSONALIZATION:"))).toBe(true);
  });

  it("flags a draft that is too long for a first-touch email", () => {
    const result = checkOutreachDraft({ ...baseDraft, body: "本文".repeat(500) }, okCtx);
    expect(result.issues.some((i) => i.startsWith("LENGTH:"))).toBe(true);
  });

  it("flags more than one CTA", () => {
    const result = checkOutreachDraft({ ...baseDraft, cta: "お電話ください。またはメールでご返信ください。" }, okCtx);
    expect(result.issues.some((i) => i.startsWith("CTA:"))).toBe(true);
  });
});
