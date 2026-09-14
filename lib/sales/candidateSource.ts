/**
 * Candidate discovery sources for the AI Sales Department.
 *
 * No real web search / SERP / directory API is wired in: this sandbox has no
 * API keys for one, and building an unattributed scraper would risk exactly
 * what the product brief prohibits (ToS violations, robots.txt disregard,
 * CAPTCHA/login bypass). Both sources below are honest about being manual
 * input or clearly-labeled synthetic fixtures — never presented as live
 * market data. Wiring in a real, ToS-compliant search/directory API is a
 * documented Phase 4 follow-up (see README).
 */

export interface DiscoveredCandidate {
  companyName: string;
  domain: string | null;
  websiteUrl: string | null;
  industry: string | null;
  region: string | null;
  sourceType: "manual" | "web_search" | "business_directory" | "serp" | "company_directory" | "event" | "referral" | "existing_contact" | "import" | "api" | "other";
  sourceUrl: string | null;
  sourceName: string | null;
  discoveryReason: string;
  testMode: boolean;
}

export interface CandidateSource {
  readonly id: string;
  discover(limit: number): Promise<DiscoveredCandidate[]>;
}

/** Wraps a single human-supplied candidate (the Lead Explorer's "add company" form). */
export class ManualCandidateSource implements CandidateSource {
  readonly id = "manual";

  constructor(private readonly candidate: {
    companyName: string;
    domain?: string | null;
    websiteUrl?: string | null;
    industry?: string | null;
    region?: string | null;
  }) {}

  async discover(): Promise<DiscoveredCandidate[]> {
    return [
      {
        companyName: this.candidate.companyName,
        domain: this.candidate.domain ?? null,
        websiteUrl: this.candidate.websiteUrl ?? null,
        industry: this.candidate.industry ?? null,
        region: this.candidate.region ?? null,
        sourceType: "manual",
        sourceUrl: null,
        sourceName: "Manual entry",
        discoveryReason: "人間が手動で投入した候補企業",
        testMode: false,
      },
    ];
  }
}

/**
 * Three seed scenarios (spec §61) as clearly-synthetic fixtures for
 * exercising the full pipeline without any live data:
 *   A — strong ICP fit, severe web problems, active growth signals → HOT
 *   B — strong-looking fit, but Do Not Contact should block it before scoring
 *   C — partial fit, moderate problems → NURTURE
 */
const FIXTURES: Record<"A" | "B" | "C", DiscoveredCandidate> = {
  A: {
    companyName: "株式会社アルファ不動産",
    domain: "alpha-fudousan.example.jp",
    websiteUrl: "https://alpha-fudousan.example.jp",
    industry: "不動産",
    region: "東京都",
    sourceType: "other",
    sourceUrl: null,
    sourceName: "Test Fixture A",
    discoveryReason: "[テストデータ] ICP条件に強く合致する架空の候補企業",
    testMode: true,
  },
  B: {
    companyName: "株式会社ベータ士業事務所",
    domain: "beta-shigyo.example.jp",
    websiteUrl: "https://beta-shigyo.example.jp",
    industry: "士業",
    region: "大阪府",
    sourceType: "other",
    sourceUrl: null,
    sourceName: "Test Fixture B",
    discoveryReason: "[テストデータ] Do Not Contact登録を検証するための架空の候補企業",
    testMode: true,
  },
  C: {
    companyName: "有限会社ガンマ製造",
    domain: "gamma-seizo.example.jp",
    websiteUrl: "https://gamma-seizo.example.jp",
    industry: "製造業",
    region: "愛知県",
    sourceType: "other",
    sourceUrl: null,
    sourceName: "Test Fixture C",
    discoveryReason: "[テストデータ] 中間スコア(NURTURE)を検証するための架空の候補企業",
    testMode: true,
  },
};

export class TestFixtureCandidateSource implements CandidateSource {
  readonly id = "test_fixture";

  constructor(private readonly scenario: "A" | "B" | "C" = "A") {}

  async discover(limit: number): Promise<DiscoveredCandidate[]> {
    return [FIXTURES[this.scenario]].slice(0, Math.max(0, limit));
  }
}
