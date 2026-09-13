import { describe, expect, it } from "vitest";
import { computeLeadScore, DEFAULT_QUALIFICATION_THRESHOLDS, DEFAULT_SCORE_WEIGHTS } from "@/lib/sales/scoring";
import { normalizeCompanyName, normalizeDomain } from "@/lib/sales/normalize";
import { checkHardExclusion } from "@/lib/sales/exclusion";

const baseIcp = {
  target_industries: ["不動産", "士業"],
  target_regions: ["全国"],
  target_services: ["SEO", "AIO"],
  requires_website: true,
  score_weights: DEFAULT_SCORE_WEIGHTS,
  qualification_thresholds: DEFAULT_QUALIFICATION_THRESHOLDS,
};

describe("normalizeCompanyName", () => {
  it("treats common corporate-entity variants as identical", () => {
    expect(normalizeCompanyName("株式会社ABC")).toBe(normalizeCompanyName("ABC株式会社"));
    expect(normalizeCompanyName("株式会社ＡＢＣ")).toBe(normalizeCompanyName("株式会社ABC"));
  });
});

describe("normalizeDomain", () => {
  it("strips protocol, www, path and query", () => {
    expect(normalizeDomain("https://www.example.co.jp/about?x=1")).toBe("example.co.jp");
    expect(normalizeDomain("example.co.jp")).toBe("example.co.jp");
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("checkHardExclusion", () => {
  it("excludes a candidate outside the configured target industries", () => {
    const result = checkHardExclusion({ industry: "飲食", region: null }, { ...baseIcp, exclusion_conditions: [] });
    expect(result.excluded).toBe(true);
  });

  it("does not exclude when the industry is unknown", () => {
    const result = checkHardExclusion({ industry: null, region: null }, { ...baseIcp, exclusion_conditions: [] });
    expect(result.excluded).toBe(false);
  });

  it("excludes on an explicit exclusion condition even if the industry would otherwise be in range", () => {
    const result = checkHardExclusion({ industry: "不動産", region: null }, { ...baseIcp, exclusion_conditions: ["不動産"] });
    expect(result.excluded).toBe(true);
  });
});

describe("computeLeadScore", () => {
  it("scores a strong ICP match with clear web problems and growth signals as HOT", () => {
    const result = computeLeadScore({
      icp: baseIcp,
      candidate: { industry: "不動産", region: "東京都", hasWebsite: true, hasContactInfo: true },
      research: { digitalScore: 20, weaknesses: ["SEO対策が不十分", "AIO/GEO未対応", "問い合わせ導線が弱い"] },
      growthSignals: [{ confidence: 0.9 }, { confidence: 0.8 }, { confidence: 0.7 }],
    });
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.qualification).toBe("HOT");
    expect(result.components).toHaveLength(7);
    expect(result.components.reduce((sum, c) => sum + c.max, 0)).toBe(100);
  });

  it("scores a weak match with no evidence as LOW, never negative or over max per component", () => {
    const result = computeLeadScore({
      icp: baseIcp,
      candidate: { industry: null, region: null, hasWebsite: false, hasContactInfo: false },
      research: null,
      growthSignals: [],
    });
    expect(result.qualification).toBe("LOW");
    for (const c of result.components) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(c.max);
    }
  });

  it("is deterministic: identical input always yields identical output", () => {
    const input = {
      icp: baseIcp,
      candidate: { industry: "士業", region: "全国", hasWebsite: true, hasContactInfo: false },
      research: { digitalScore: 55, weaknesses: ["SEO対策が不十分"] },
      growthSignals: [{ confidence: 0.5 }],
    };
    const a = computeLeadScore(input);
    const b = computeLeadScore(input);
    expect(a).toEqual(b);
  });
});
