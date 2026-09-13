export const SCORE_VERSION = "v1";

export interface ScoreWeights {
  icp_fit: number;
  business_potential: number;
  web_problem: number;
  timing: number;
  service_fit: number;
  contactability: number;
  confidence: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  icp_fit: 25,
  business_potential: 20,
  web_problem: 20,
  timing: 15,
  service_fit: 10,
  contactability: 5,
  confidence: 5,
};

export interface QualificationThresholds {
  hot: number;
  warm: number;
  nurture: number;
}

export const DEFAULT_QUALIFICATION_THRESHOLDS: QualificationThresholds = { hot: 80, warm: 65, nurture: 50 };

export type Qualification = "HOT" | "WARM" | "NURTURE" | "LOW";

export interface ScoreComponent {
  key: keyof ScoreWeights;
  label: string;
  score: number;
  max: number;
  reason: string;
}

export interface ScoreResult {
  total: number;
  qualification: Qualification;
  components: ScoreComponent[];
}

export interface ScoringInput {
  icp: {
    target_industries: string[];
    target_regions: string[];
    target_services: string[];
    requires_website: boolean | null;
    score_weights: Partial<ScoreWeights>;
    qualification_thresholds: Partial<QualificationThresholds>;
  };
  candidate: {
    industry: string | null;
    region: string | null;
    hasWebsite: boolean;
    hasContactInfo: boolean;
  };
  research: { digitalScore: number | null; weaknesses: string[] } | null;
  growthSignals: Array<{ confidence: number }>;
}

function qualify(total: number, thresholds: QualificationThresholds): Qualification {
  if (total >= thresholds.hot) return "HOT";
  if (total >= thresholds.warm) return "WARM";
  if (total >= thresholds.nurture) return "NURTURE";
  return "LOW";
}

/**
 * Deterministic, multi-axis lead score (spec §17-19) — never "LLM vibes".
 * Every component is derived from real stored data (ICP config, research
 * findings, growth signals, contactability facts) with a human-readable
 * reason, so a CEO can see exactly why a lead scored the way it did.
 */
export function computeLeadScore(input: ScoringInput): ScoreResult {
  const w: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...input.icp.score_weights };
  const thresholds: QualificationThresholds = { ...DEFAULT_QUALIFICATION_THRESHOLDS, ...input.icp.qualification_thresholds };
  const components: ScoreComponent[] = [];

  // ICP Fit: fraction of configured criteria (industry/region/website) the candidate matches.
  {
    const checks: Array<{ ok: boolean; label: string }> = [];
    if (input.icp.target_industries.length > 0) {
      checks.push({ ok: Boolean(input.candidate.industry && input.icp.target_industries.includes(input.candidate.industry)), label: "業種" });
    }
    if (input.icp.target_regions.length > 0 && !input.icp.target_regions.includes("全国")) {
      checks.push({ ok: Boolean(input.candidate.region && input.icp.target_regions.includes(input.candidate.region)), label: "地域" });
    }
    if (input.icp.requires_website) {
      checks.push({ ok: input.candidate.hasWebsite, label: "Webサイト有無" });
    }
    const ratio = checks.length > 0 ? checks.filter((c) => c.ok).length / checks.length : 0.6;
    const score = Math.round(ratio * w.icp_fit);
    const reason =
      checks.length > 0
        ? `一致: ${checks.filter((c) => c.ok).map((c) => c.label).join("/") || "なし"} (${checks.length}項目中${checks.filter((c) => c.ok).length}件)`
        : "ICP条件が未設定のため中間値";
    components.push({ key: "icp_fit", label: "ICP Fit", score, max: w.icp_fit, reason });
  }

  // Business Potential: proxy from having a real web presence + observed weaknesses volume
  // (more surface area for improvement work generally correlates with more billable scope).
  {
    let ratio = 0.3;
    const reasons: string[] = [];
    if (input.candidate.hasWebsite) {
      ratio += 0.3;
      reasons.push("Webサイトを保有");
    }
    if (input.research) {
      ratio += Math.min(input.research.weaknesses.length, 3) * 0.1;
      reasons.push(`課題${input.research.weaknesses.length}件を確認`);
    }
    ratio = Math.min(ratio, 1);
    const score = Math.round(ratio * w.business_potential);
    components.push({
      key: "business_potential",
      label: "Business Potential",
      score,
      max: w.business_potential,
      reason: reasons.length > 0 ? reasons.join(" / ") : "情報不足のため下限値",
    });
  }

  // Web Problem Severity: inverse of the digital maturity score from research findings.
  {
    let score: number;
    let reason: string;
    if (input.research?.digitalScore != null) {
      const severity = (100 - input.research.digitalScore) / 100;
      score = Math.round(severity * w.web_problem);
      reason = `デジタル成熟度${input.research.digitalScore}/100（低いほど問題深刻）`;
    } else {
      score = Math.round(w.web_problem * 0.5);
      reason = "Webサイト診断未実施のため中間値";
    }
    components.push({ key: "web_problem", label: "Web Problem Severity", score, max: w.web_problem, reason });
  }

  // Timing Signal: from recorded growth signals (findings.type = 'growth_signal').
  {
    const count = input.growthSignals.length;
    const avgConfidence = count > 0 ? input.growthSignals.reduce((sum, s) => sum + s.confidence, 0) / count : 0;
    const ratio = count === 0 ? 0 : Math.min(1, (count / 3) * avgConfidence);
    const score = Math.round(ratio * w.timing);
    components.push({
      key: "timing",
      label: "Timing Signal",
      score,
      max: w.timing,
      reason: count > 0 ? `成長シグナル${count}件（平均確信度${Math.round(avgConfidence * 100)}%）` : "成長シグナルなし",
    });
  }

  // Service Fit: overlap between the tenant's target services and services implied by observed weaknesses.
  {
    let score: number;
    let reason: string;
    if (input.icp.target_services.length === 0) {
      score = w.service_fit;
      reason = "対象サービス条件が未設定のため満点";
    } else {
      const weaknessText = (input.research?.weaknesses ?? []).join(" ").toLowerCase();
      const matched = input.icp.target_services.filter((s) => weaknessText.includes(s.toLowerCase()));
      const ratio = matched.length > 0 ? Math.min(1, matched.length / Math.min(3, input.icp.target_services.length)) : 0.2;
      score = Math.round(ratio * w.service_fit);
      reason = matched.length > 0 ? `課題との一致サービス: ${matched.join(", ")}` : "明確なサービス一致なし";
    }
    components.push({ key: "service_fit", label: "Service Fit", score, max: w.service_fit, reason });
  }

  // Contactability: can we even reach them through a public channel.
  {
    const ok = input.candidate.hasWebsite || input.candidate.hasContactInfo;
    const score = ok ? w.contactability : 0;
    components.push({
      key: "contactability",
      label: "Contactability",
      score,
      max: w.contactability,
      reason: ok ? "Webサイトまたは連絡先を確認済み" : "公開連絡経路が未確認",
    });
  }

  // Confidence: how much real evidence backs this score.
  {
    let signals = 0;
    if (input.research) signals += 1;
    if (input.research?.digitalScore != null) signals += 1;
    if (input.growthSignals.length > 0) signals += 1;
    const ratio = signals / 3;
    const score = Math.round(ratio * w.confidence);
    components.push({
      key: "confidence",
      label: "Confidence",
      score,
      max: w.confidence,
      reason: `根拠データ ${signals}/3 種類を確認`,
    });
  }

  const total = components.reduce((sum, c) => sum + c.score, 0);
  return { total, qualification: qualify(total, thresholds), components };
}
