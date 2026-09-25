import { describe, expect, it } from "vitest";
import { checkProposalDraft, type ProposalCriticInput } from "@/lib/sales/proposalCritic";

const base: ProposalCriticInput = {
  executiveSummary: "貴社の課題に対しSEO/AIOをご提案します。",
  clientChallenges: ["問い合わせが少ない"],
  goals: ["問い合わせ数の増加"],
  scope: ["SEO", "AIO"],
  kpis: ["問い合わせ数"],
  hasEstimate: true,
  unmatchedServices: [],
  marginRate: 0.4,
};

describe("checkProposalDraft", () => {
  it("passes a well-formed proposal", () => {
    expect(checkProposalDraft(base)).toEqual({ passed: true, issues: [] });
  });

  it("flags a missing estimate", () => {
    const result = checkProposalDraft({ ...base, hasEstimate: false });
    expect(result.issues.some((i) => i.startsWith("PRICE:"))).toBe(true);
  });

  it("flags a service with no Price Master match", () => {
    const result = checkProposalDraft({ ...base, unmatchedServices: ["ブロックチェーン導入"] });
    expect(result.issues.some((i) => i.includes("ブロックチェーン導入"))).toBe(true);
  });

  it("flags a negative margin for CEO attention", () => {
    const result = checkProposalDraft({ ...base, marginRate: -0.1 });
    expect(result.issues.some((i) => i.startsWith("MARGIN:"))).toBe(true);
  });

  it("flags exaggerated claims", () => {
    const result = checkProposalDraft({ ...base, executiveSummary: "導入すれば100%成果が確実に出ます。" });
    expect(result.issues.some((i) => i.startsWith("CLAIM_RISK:"))).toBe(true);
  });

  it("flags missing structural sections", () => {
    const result = checkProposalDraft({ ...base, clientChallenges: [], goals: [], scope: [], kpis: [] });
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
  });
});
