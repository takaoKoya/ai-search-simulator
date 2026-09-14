import { describe, expect, it } from "vitest";
import { checkUpsellDuplicate, computeCooldownUntil, criticUpsellCandidate } from "@/lib/server/upsell";

describe("checkUpsellDuplicate", () => {
  it("flags a duplicate while an open candidate for the same client+service exists", () => {
    const result = checkUpsellDuplicate(
      { clientId: "c1", recommendedService: "CRO", problem: "p" },
      [{ clientId: "c1", recommendedService: "CRO", status: "APPROVAL_PENDING", cooldownUntil: null }],
      new Date("2026-01-01")
    );
    expect(result.isDuplicate).toBe(true);
  });

  it("does not flag a different client or service", () => {
    const result = checkUpsellDuplicate(
      { clientId: "c1", recommendedService: "CRO", problem: "p" },
      [{ clientId: "c2", recommendedService: "CRO", status: "APPROVAL_PENDING", cooldownUntil: null }],
      new Date("2026-01-01")
    );
    expect(result.isDuplicate).toBe(false);
  });

  it("Test Case F: respects the cooldown window after a human reject", () => {
    const rejectedAt = new Date("2026-01-01T00:00:00Z");
    const cooldownUntil = computeCooldownUntil(rejectedAt, 90);
    const result = checkUpsellDuplicate(
      { clientId: "c1", recommendedService: "Ads", problem: "p" },
      [{ clientId: "c1", recommendedService: "Ads", status: "REJECTED", cooldownUntil: cooldownUntil.toISOString() }],
      new Date("2026-02-01")
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("Cooldown");
  });

  it("allows re-detection once the cooldown has elapsed", () => {
    const rejectedAt = new Date("2026-01-01T00:00:00Z");
    const cooldownUntil = computeCooldownUntil(rejectedAt, 90);
    const result = checkUpsellDuplicate(
      { clientId: "c1", recommendedService: "Ads", problem: "p" },
      [{ clientId: "c1", recommendedService: "Ads", status: "REJECTED", cooldownUntil: cooldownUntil.toISOString() }],
      new Date("2026-06-01")
    );
    expect(result.isDuplicate).toBe(false);
  });
});

describe("criticUpsellCandidate — Test Case E (already in scope)", () => {
  it("rejects a recommendation already covered by the current contract", () => {
    const result = criticUpsellCandidate({
      clientId: "c1",
      recommendedService: "SEO",
      problem: "検索順位が下落",
      businessImpact: "流入減",
      currentContractServices: ["SEO", "AIO"],
      recentProposalsInWindow: 0,
      maxProposalsPerPeriod: 2,
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("Scope内"))).toBe(true);
  });

  it("passes a genuinely new service with a stated client benefit", () => {
    const result = criticUpsellCandidate({
      clientId: "c1",
      recommendedService: "CRO",
      problem: "問い合わせ転換率が低い",
      businessImpact: "商談数の増加につながる",
      currentContractServices: ["SEO"],
      recentProposalsInWindow: 0,
      maxProposalsPerPeriod: 2,
    });
    expect(result.passed).toBe(true);
  });

  it("blocks once the tenant's Client Fatigue limit is reached (spec §142)", () => {
    const result = criticUpsellCandidate({
      clientId: "c1",
      recommendedService: "CRO",
      problem: "問い合わせ転換率が低い",
      businessImpact: "商談数の増加につながる",
      currentContractServices: ["SEO"],
      recentProposalsInWindow: 2,
      maxProposalsPerPeriod: 2,
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("Fatigue"))).toBe(true);
  });
});
