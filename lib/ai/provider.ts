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
    if (/断言|保証/.test(subjectSummary)) issues.push("成果保証と取られかねない表現を含む");
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
