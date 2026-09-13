/**
 * AI Provider Adapter.
 *
 * Phase 1 intentionally ships only `TemplateProvider`: deterministic,
 * rule-based content generation with no outbound network calls. This keeps
 * the vertical slice runnable without API keys/secrets and avoids any
 * unconfirmed external send. The interface below is the seam where
 * OpenAI/Claude/Gemini adapters plug in later (per `agents.provider` /
 * `agents.model` columns) without touching graph or route code — implement
 * `AIProvider` and wire it into `getProviderForAgent`.
 */

export type AgentTaskType =
  | "company_research"
  | "website_diagnosis_lite"
  | "sales_hypothesis"
  | "sales_draft"
  | "sales_strategy"
  | "contract_review"
  | "critic_review"
  | "qa_check"
  | "execution_task"
  | "report";

export interface AgentTaskContext {
  [key: string]: unknown;
}

export interface AgentTaskResult {
  summary: string;
  data: Record<string, unknown>;
}

export interface AIProvider {
  readonly id: string;
  generate(taskType: AgentTaskType, context: AgentTaskContext): Promise<AgentTaskResult>;
}

/** Minimal agent shape needed to pick a provider; avoids importing DB types here. */
export interface ProviderSelectable {
  provider: string;
  model?: string | null;
}

// Deterministic pseudo-randomness seeded from input strings, so the same
// lead/company always yields the same simulated findings (reproducible for
// tests and reload/resume checks) without ever calling Math.random().
function seededScore(seed: string, min: number, max: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = (hash >>> 0) / 0xffffffff;
  return Math.round(min + normalized * (max - min));
}

export class TemplateProvider implements AIProvider {
  readonly id = "template";

  async generate(taskType: AgentTaskType, context: AgentTaskContext): Promise<AgentTaskResult> {
    switch (taskType) {
      case "company_research":
        return this.companyResearch(context);
      case "website_diagnosis_lite":
        return this.websiteDiagnosisLite(context);
      case "sales_hypothesis":
        return this.salesHypothesis(context);
      case "sales_draft":
        return this.salesDraft(context);
      case "sales_strategy":
        return this.salesStrategy(context);
      case "contract_review":
        return this.contractReview(context);
      case "critic_review":
        return this.criticReview(context);
      case "qa_check":
        return this.qaCheck(context);
      case "execution_task":
        return this.executionTask(context);
      case "report":
        return this.report(context);
      default:
        throw new Error(`Unsupported task type: ${taskType satisfies never}`);
    }
  }

  private companyResearch(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const industry = String(context.industry ?? "不明");
    const digitalScore = seededScore(companyName + "digital", 20, 80);
    const strengths = [
      `${industry}業界での実績と既存顧客基盤`,
      "自社サイトを保有し情報発信を行っている",
    ];
    const weaknesses = [
      digitalScore < 50 ? "AI検索(GEO/AEO)経由の流入がほぼ無い" : "SEOは一定水準だがAI検索最適化が未着手",
      "問い合わせ導線が電話中心でWeb完結していない",
    ];
    return {
      summary: `${companyName}(${industry})を調査。デジタル成熟度スコア${digitalScore}/100。強み${strengths.length}件、課題${weaknesses.length}件を検出。`,
      data: { companyName, industry, digitalScore, strengths, weaknesses },
    };
  }

  private salesStrategy(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const weaknesses = (context.weaknesses as string[] | undefined) ?? [];
    const digitalScore = Number(context.digitalScore ?? 50);
    const amount = seededScore(companyName + "amount", 150_000, 600_000);
    const pitch =
      `${companyName}様向けご提案骨子:\n` +
      `現状のデジタル成熟度は${digitalScore}/100と推定。` +
      (weaknesses[0] ? `特に「${weaknesses[0]}」が機会損失の主因と考えられます。` : "") +
      `AIO/SEO改善パッケージにより問い合わせ経路の多様化を提案。`;
    return {
      summary: `${companyName}向け営業候補(見積目安 ¥${amount.toLocaleString()}/月)を作成。`,
      data: { pitch, amount, currency: "JPY", recommendedStage: "candidate" },
    };
  }

  /**
   * Simulated lite diagnosis, deterministically derived from the URL string.
   * This does NOT fetch the real page — no outbound network call, no risk of
   * treating fetched page content as instructions (§55). `simulated: true`
   * is always present in the output so callers/UI never present this as a
   * live crawl result. A real fetch-based diagnosis (with untrusted-content
   * handling) is a Phase 4 item — see README.
   */
  private websiteDiagnosisLite(context: AgentTaskContext): AgentTaskResult {
    const websiteUrl = context.websiteUrl as string | null | undefined;
    if (!websiteUrl) {
      return {
        summary: "Webサイトが確認できないため診断をスキップしました。",
        data: { hasWebsite: false, simulated: true, checks: null },
      };
    }
    const https = websiteUrl.startsWith("https://");
    const performanceScore = seededScore(websiteUrl + "speed", 30, 95);
    const mobileFriendly = seededScore(websiteUrl + "mobile", 0, 1) === 1;
    const hasContactForm = seededScore(websiteUrl + "contact", 0, 1) === 1;
    const hasStructuredData = seededScore(websiteUrl + "structured", 0, 1) === 1;
    const monthsSinceUpdate = seededScore(websiteUrl + "update", 0, 24);
    const checks = {
      httpStatus: 200,
      https,
      indexable: true,
      mobileFriendly,
      performanceScore,
      hasContactForm,
      hasStructuredData,
      monthsSinceLastUpdate: monthsSinceUpdate,
    };
    return {
      summary: `${websiteUrl} の簡易診断(simulated)。パフォーマンス${performanceScore}/100、最終更新から${monthsSinceUpdate}ヶ月経過と推定。`,
      data: { hasWebsite: true, simulated: true, checks },
    };
  }

  private salesHypothesis(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const weaknesses = (context.weaknesses as string[] | undefined) ?? [];
    const digitalScore = context.digitalScore != null ? Number(context.digitalScore) : null;
    const monthsSinceUpdate = context.monthsSinceUpdate != null ? Number(context.monthsSinceUpdate) : null;

    const candidates: Array<{ service: string; reason: string }> = [];
    if (digitalScore !== null && digitalScore < 50) {
      candidates.push({ service: "SEO", reason: `デジタル成熟度${digitalScore}/100と低く、自然検索流入の改善余地が大きい` });
    }
    if (monthsSinceUpdate !== null && monthsSinceUpdate >= 6) {
      candidates.push({ service: "AIO/GEO", reason: `サイトが${monthsSinceUpdate}ヶ月更新されておらず、AI検索での評価向上余地がある` });
    }
    if (weaknesses.some((w) => w.includes("問い合わせ"))) {
      candidates.push({ service: "CRO", reason: "問い合わせ導線に課題があり、転換率改善の余地がある" });
    }
    if (candidates.length === 0) {
      candidates.push({ service: "Web Renewal", reason: "具体的な課題データが不足しているため、サイト刷新を起点とした提案が妥当" });
    }
    const recommendedServices = candidates.slice(0, 3);

    const observedProblem = weaknesses[0] ?? "詳細な課題は追加調査が必要（不明）";
    const whyNow =
      monthsSinceUpdate !== null && monthsSinceUpdate >= 6
        ? `サイトが${monthsSinceUpdate}ヶ月更新されておらず、対応の緊急度が上がっている`
        : "デジタル施策を見直すのに適したタイミングと判断";
    const evidenceCount = [digitalScore !== null, weaknesses.length > 0, monthsSinceUpdate !== null].filter(Boolean).length;
    const confidence = evidenceCount >= 2 ? "MEDIUM" : "LOW";
    const amount = seededScore(companyName + "amount", 150_000, 500_000);

    return {
      summary: `${companyName}向けの営業仮説を作成（推奨: ${recommendedServices.map((r) => r.service).join(" / ")}）`,
      data: {
        observedProblem,
        businessImpact: "問い合わせ経路が限定的で、機会損失が生じている可能性がある",
        whyNow,
        recommendedServices,
        expectedOutcome: "問い合わせ数の増加とAI検索経由の露出改善",
        confidence,
        evidenceCount,
        unknowns: ["正確な月間マーケティング予算", "社内のWeb担当者の有無"],
        nextInformationNeeded: "現在のマーケティング予算感と意思決定者",
        estimatedInitialValue: amount,
        estimatedMonthlyValue: Math.round(amount * 0.6),
        estimatedAnnualValue: Math.round(amount * 0.6 * 12),
        // No service price table exists yet in this tenant — never fabricate one (§24).
        priceRecommendation: null,
      },
    };
  }

  private salesDraft(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const observedProblem = String(context.observedProblem ?? "");
    const recommendedServices = (context.recommendedServices as Array<{ service: string; reason: string }> | undefined) ?? [];
    const primaryService = recommendedServices[0]?.service ?? "Web改善";

    const subject = `${companyName}様へ：${primaryService}に関するご相談`;
    const body = [
      `${companyName} ご担当者様`,
      "",
      "初めてご連絡いたします。",
      observedProblem
        ? `貴社Webサイトを拝見し、${observedProblem}という点で改善のご支援ができる可能性があると考えご連絡いたしました。`
        : "貴社のWeb活用について、ご支援できる可能性があると考えご連絡いたしました。",
      "",
      `弊社では${primaryService}を中心に、同様の課題を抱える企業様のご支援を行っております。よろしければ一度、貴社の状況に合わせた改善余地について、簡単にご説明する機会をいただけますと幸いです。`,
      "",
      "ご検討のほど、よろしくお願いいたします。",
    ].join("\n");

    return {
      summary: `${companyName}向けの営業文Draftを作成しました（channel: email、送信はしていません）。`,
      data: { subject, body, channel: "email" },
    };
  }

  private contractReview(context: AgentTaskContext): AgentTaskResult {
    const amount = Number(context.amount ?? 0);
    const findings: { field: string; note: string; risk: "LOW" | "MEDIUM" | "HIGH" }[] = [
      { field: "契約期間", note: "初回12ヶ月、以後自動更新(1ヶ月前告知で解約可)", risk: "LOW" },
      { field: "料金", note: `月額 ¥${amount.toLocaleString()}、税別`, risk: "LOW" },
      { field: "支払条件", note: "月末締め翌月末払い", risk: "LOW" },
      { field: "損害賠償", note: "賠償上限が契約金額の1ヶ月分に限定されておらず要確認", risk: "MEDIUM" },
      { field: "再委託", note: "再委託先の事前承諾条項なし", risk: "MEDIUM" },
      { field: "秘密保持", note: "標準的なNDA条項あり", risk: "LOW" },
      { field: "知的財産", note: "納品物の著作権譲渡タイミングが未明記", risk: "MEDIUM" },
      { field: "個人情報", note: "個人情報保護法に基づく標準条項あり", risk: "LOW" },
      { field: "納品/検収", note: "検収期間が3営業日と短い", risk: "MEDIUM" },
    ];
    const riskLevel = findings.some((f) => f.risk === "HIGH")
      ? "HIGH"
      : findings.some((f) => f.risk === "MEDIUM")
        ? "MEDIUM"
        : "LOW";
    return {
      summary: `契約内容を抽出。リスク${riskLevel}(要確認${findings.filter((f) => f.risk !== "LOW").length}件)。最終確定は人間判断が必要です。`,
      data: { riskLevel, findings },
    };
  }

  private criticReview(context: AgentTaskContext): AgentTaskResult {
    const subjectSummary = String(context.subjectSummary ?? "");
    const issues: string[] = [];
    if (subjectSummary.length < 10) issues.push("内容が簡潔すぎ、根拠の提示が不足している");
    if (/断言|保証|確実に|100%|絶対/.test(subjectSummary)) issues.push("成果を確約しかねない表現を含む");

    // Structured checks used by the Sales Hypothesis / Sales Draft critics
    // (spec §25, §49) — only evaluated when the caller supplies the field.
    const recommendedServicesCount = context.recommendedServicesCount as number | undefined;
    if (recommendedServicesCount !== undefined && recommendedServicesCount > 3) {
      issues.push("推奨サービスが3件を超えている(過多)");
    }
    const confidence = context.confidence as string | undefined;
    const evidenceCount = context.evidenceCount as number | undefined;
    if (confidence === "HIGH" && (evidenceCount ?? 0) < 2) {
      issues.push("Confidenceが高いにもかかわらずEvidenceが不足している");
    }
    if (context.hasPriceNumbers && !context.hasPriceReason) {
      issues.push("価格の根拠が不足している");
    }
    const draftLength = context.draftLength as number | undefined;
    if (draftLength !== undefined && draftLength > 800) {
      issues.push("営業文が長すぎる");
    }
    if (context.containsPii) {
      issues.push("不必要な個人情報を含んでいる可能性がある");
    }

    const passed = issues.length === 0;
    return {
      summary: passed ? "Critic: 差し戻し無し。承認プロセスへ進めて問題ありません。" : `Critic: ${issues.length}件の差し戻し事由を検出。`,
      data: { passed, issues },
    };
  }

  private qaCheck(context: AgentTaskContext): AgentTaskResult {
    const deliverableTitle = String(context.deliverableTitle ?? "成果物");
    return {
      summary: `QA: ${deliverableTitle}の品質チェックを完了。`,
      data: { passed: true, checklist: ["表記ゆれ", "リンク切れ", "個人情報の誤掲載"].map((c) => ({ item: c, passed: true })) },
    };
  }

  private executionTask(context: AgentTaskContext): AgentTaskResult {
    const title = String(context.title ?? "タスク");
    return {
      summary: `${title}を実施し、成果物ドラフトを作成しました。`,
      data: { output: `${title}の実施結果サマリー(ドラフト)` },
    };
  }

  private report(context: AgentTaskContext): AgentTaskResult {
    const projectName = String(context.projectName ?? "プロジェクト");
    return {
      summary: `${projectName}の月次レポートを作成しました。`,
      data: { highlights: ["KPI進捗を集計", "次月アクションを提案"] },
    };
  }
}

const templateProvider = new TemplateProvider();

/**
 * Resolves the provider for a given agent. Always returns the template
 * provider today; once a real provider is wired in, branch on
 * `agent.provider` here (e.g. "openai" | "anthropic" | "gemini" | "template").
 */
export function getProviderForAgent(_agent: ProviderSelectable): AIProvider {
  return templateProvider;
}
