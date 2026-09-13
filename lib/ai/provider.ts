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
  | "report"
  | "sales_outreach_email"
  | "reply_classification"
  | "reply_draft"
  | "meeting_prep"
  | "meeting_minutes"
  | "proposal_draft"
  | "negotiation_analysis";

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
      case "sales_outreach_email":
        return this.salesOutreachEmail(context);
      case "reply_classification":
        return this.replyClassification(context);
      case "reply_draft":
        return this.replyDraft(context);
      case "meeting_prep":
        return this.meetingPrep(context);
      case "meeting_minutes":
        return this.meetingMinutes(context);
      case "proposal_draft":
        return this.proposalDraft(context);
      case "negotiation_analysis":
        return this.negotiationAnalysis(context);
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

  /**
   * Structured first-touch outreach email (spec §6-8) — never a plain text
   * blob. `evidence` is only populated when the caller supplies a real
   * source (a `findings` row); with none, the personalization line stays
   * generic rather than inventing a source (spec §8).
   */
  private salesOutreachEmail(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const recipientName = (context.recipientName as string | null) ?? null;
    const observedProblem = String(context.observedProblem ?? "貴社のWeb活用状況");
    const recommendedServices = (context.recommendedServices as Array<{ service: string; reason: string }> | undefined) ?? [];
    const whyNow = String(context.whyNow ?? "");
    const evidenceSourceUrl = (context.evidenceSourceUrl as string | null) ?? null;
    const evidenceCapturedAt = (context.evidenceCapturedAt as string | null) ?? null;
    const evidenceText = (context.evidenceText as string | null) ?? null;
    const primaryService = recommendedServices[0]?.service ?? "Web改善";

    const evidence = evidenceSourceUrl && evidenceText ? [{ sourceUrl: evidenceSourceUrl, capturedAt: evidenceCapturedAt, evidence: evidenceText }] : [];
    const personalizedObservation =
      evidence.length > 0
        ? `${evidenceText}という点を拝見しました。`
        : `貴社のWebサイトを拝見し、${observedProblem}という点に着目いたしました。`;

    const subject = `${companyName}様へ：${primaryService}に関するご相談`;
    const opening = recipientName ? `${companyName} ${recipientName}様` : `${companyName} ご担当者様`;
    const problemHypothesis = observedProblem;
    const valueProposition = `弊社では${primaryService}を中心に、同様の課題を抱える企業様のご支援を行っております。${whyNow ? whyNow + "。" : ""}`;
    const cta = "よろしければ15分ほどお時間をいただき、貴社の状況に合わせた改善余地について簡単にご説明させてください。";
    const signature = "営業担当";

    const body = [
      opening,
      "",
      "初めてご連絡いたします。",
      personalizedObservation,
      valueProposition,
      "",
      cta,
      "",
      "ご検討のほど、よろしくお願いいたします。",
      signature,
    ].join("\n");

    return {
      summary: `${companyName}向けの営業メールDraftを作成しました（送信はしていません）。`,
      data: { subject, opening, personalizedObservation, problemHypothesis, valueProposition, evidence, cta, signature, body },
    };
  }

  /**
   * Deterministic keyword-rule reply classification (spec §16) — not a
   * model "understanding" the email, an explicit, auditable rule set so a
   * CEO can see exactly why a reply was bucketed a given way.
   */
  private replyClassification(context: AgentTaskContext): AgentTaskResult {
    const text = String(context.replyText ?? "");
    const rules: Array<{ pattern: RegExp; classification: string; confidence: number }> = [
      { pattern: /今後.{0,4}(連絡|営業).{0,4}(しない|不要|お控え)|配信停止|二度と連絡/, classification: "DO_NOT_CONTACT", confidence: 0.95 },
      { pattern: /mailer-daemon|delivery.{0,3}failed|宛先不明|届きません/i, classification: "BOUNCE", confidence: 0.9 },
      { pattern: /out of office|automatic reply|自動返信|不在のため/i, classification: "AUTO_REPLY", confidence: 0.9 },
      { pattern: /商談|打ち合わせ|お打合せ|日程|ミーティング|お時間.{0,4}(いただけ|頂け)/, classification: "MEETING_REQUEST", confidence: 0.85 },
      { pattern: /料金|価格|見積|費用/, classification: "PRICE_QUESTION", confidence: 0.8 },
      { pattern: /他部署|担当ではない|紹介いたします|紹介します/, classification: "REFERRAL", confidence: 0.75 },
      { pattern: /不要|お断り|結構です|興味(が)?ありません|必要ありません/, classification: "NOT_INTERESTED", confidence: 0.85 },
      { pattern: /興味|詳しく|関心があります/, classification: "INTERESTED", confidence: 0.75 },
      { pattern: /検討|前向き|良さそう/, classification: "POSITIVE", confidence: 0.6 },
      { pattern: /今は|現在は|タイミング|後日|来期/, classification: "NOT_NOW", confidence: 0.6 },
      { pattern: /\?|？|教えてください|でしょうか/, classification: "QUESTION", confidence: 0.5 },
    ];
    const match = rules.find((r) => r.pattern.test(text));
    const classification = match?.classification ?? "UNKNOWN";
    const confidence = match?.confidence ?? 0.3;
    return {
      summary: `返信を${classification}に分類しました（確信度${Math.round(confidence * 100)}%）。`,
      data: { classification, confidence },
    };
  }

  private replyDraft(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const classification = String(context.classification ?? "UNKNOWN");
    const replyText = String(context.replyText ?? "");
    const recommendedServices = (context.recommendedServices as Array<{ service: string; reason: string }> | undefined) ?? [];
    const primaryService = recommendedServices[0]?.service ?? "Web改善";

    const intentByClass: Record<string, string> = {
      MEETING_REQUEST: "商談の日程調整を希望している",
      INTERESTED: "サービス内容に関心を示している",
      PRICE_QUESTION: "料金・見積を知りたがっている",
      POSITIVE: "前向きな反応を示している",
      QUESTION: "追加の質問をしている",
      NOT_NOW: "現時点では検討タイミングではない",
      REFERRAL: "担当者の紹介を提案している",
      NOT_INTERESTED: "関心がない意思を示している",
      DO_NOT_CONTACT: "今後の連絡を拒否している",
      AUTO_REPLY: "自動応答メールである",
      BOUNCE: "メールが届いていない可能性がある",
      UNKNOWN: "意図が明確に読み取れない",
    };
    const actionByClass: Record<string, string> = {
      MEETING_REQUEST: "商談候補日時を提示する",
      INTERESTED: "資料と商談の提案を行う",
      PRICE_QUESTION: "概算レンジを提示し商談へ誘導する",
      POSITIVE: "次のアクション（商談）を提案する",
      QUESTION: "質問へ回答し関係を継続する",
      NOT_NOW: "Follow-up候補日を設定し様子を見る",
      REFERRAL: "紹介先へのアプローチ許可を確認する",
      NOT_INTERESTED: "丁寧にお礼を伝え、無理に再営業しない",
      DO_NOT_CONTACT: "Do Not Contactへ登録し、以後連絡しない",
      AUTO_REPLY: "後日の再送信タイミングを設定する",
      BOUNCE: "宛先の再確認を行う",
      UNKNOWN: "人間が内容を確認してから対応する",
    };
    const opportunitySignal = ["MEETING_REQUEST", "INTERESTED", "POSITIVE", "PRICE_QUESTION"].includes(classification);
    const risk = classification === "DO_NOT_CONTACT" ? "再営業すると信頼を損なうリスクが高い" : null;

    const draftSubject = `Re: ${companyName}様よりのご返信`;
    const draftBody =
      classification === "DO_NOT_CONTACT"
        ? null // never draft a reply to someone who asked not to be contacted (spec §18)
        : [
            `${companyName} ご担当者様`,
            "",
            "ご返信いただきありがとうございます。",
            classification === "MEETING_REQUEST"
              ? "商談の候補日時を追ってご連絡いたします。"
              : `${primaryService}について、貴社の状況に合わせてご説明させていただければと存じます。`,
            "",
            "よろしくお願いいたします。",
          ].join("\n");

    return {
      summary: `${companyName}への返信案を作成しました（${intentByClass[classification]}）。`,
      data: {
        intent: intentByClass[classification] ?? intentByClass.UNKNOWN,
        keyPoints: replyText.length > 0 ? [replyText.slice(0, 120)] : [],
        questions: classification === "QUESTION" ? [replyText.slice(0, 200)] : [],
        opportunitySignal,
        risk,
        recommendedAction: actionByClass[classification] ?? actionByClass.UNKNOWN,
        draftSubject,
        draftBody,
      },
    };
  }

  private meetingPrep(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const qualification = String(context.qualification ?? "不明");
    const weaknesses = (context.weaknesses as string[] | undefined) ?? [];
    const growthSignalsCount = Number(context.growthSignalsCount ?? 0);
    const recommendedServices = (context.recommendedServices as Array<{ service: string; reason: string }> | undefined) ?? [];

    const agendaDraft = [
      "挨拶・自己紹介",
      "現状確認（貴社の事業・体制）",
      "課題の確認",
      "商談のゴール確認",
      "現在のWeb施策の状況",
      "ご予算感の確認",
      "決裁者・意思決定プロセスの確認",
      "スケジュール感の確認",
      `提案方針のご説明（${recommendedServices.map((s) => s.service).join(" / ") || "検討中"}）`,
      "Next Actionの確認",
    ];

    return {
      summary: `${companyName}の商談準備資料を作成しました。`,
      data: {
        companyOverview: `${companyName}（Lead Qualification: ${qualification}）`,
        webIssues: weaknesses,
        growthSignalsSummary: growthSignalsCount > 0 ? `成長シグナル${growthSignalsCount}件を確認済み` : "成長シグナルは未検出",
        recommendedProposal: recommendedServices.map((s) => s.service),
        questionsToAsk: ["現在の月間問い合わせ数は？", "Web施策の予算感は？", "意思決定に関わる方は？"],
        risks: qualification === "NURTURE" ? ["緊急度が低い可能性がある"] : [],
        meetingGoal: "課題とゴールの明確化、次回提案への合意",
        agendaDraft,
      },
    };
  }

  /**
   * Deterministic keyword extraction from a transcript. Anything not found
   * is the literal placeholder (UNASSIGNED/UNSET/UNKNOWN), never a guess —
   * spec §30 "Meeting Hallucination禁止".
   */
  private meetingMinutes(context: AgentTaskContext): AgentTaskResult {
    const transcript = String(context.transcript ?? "");
    const companyName = String(context.companyName ?? "対象企業");

    const budgetMatch = transcript.match(/(予算|budget)[^\d]{0,10}([0-9,万円]+)/i);
    const timingMatch = transcript.match(/(来月|今期|来期|\d+月|\d+週間以内|なるべく早く)/);
    const decisionMakerMatch = transcript.match(/(決裁者|意思決定者|決める人)は([^\s。、]+)/);

    return {
      summary: `${companyName}の商談議事録Draftを作成しました（人間の確認が必要です）。`,
      data: {
        summary: transcript.length > 0 ? transcript.slice(0, 200) : "文字起こしがありません。",
        clientNeeds: transcript.includes("課題") ? "文字起こし中に課題への言及あり（詳細は人間が確認）" : "UNKNOWN",
        goals: transcript.includes("目標") || transcript.includes("ゴール") ? "文字起こし中にゴールへの言及あり（詳細は人間が確認）" : "UNKNOWN",
        kpis: "UNKNOWN",
        budget: budgetMatch ? budgetMatch[2] : "UNKNOWN",
        authority: decisionMakerMatch ? decisionMakerMatch[2] : "UNASSIGNED",
        timing: timingMatch ? timingMatch[1] : "UNSET",
        decisions: [],
        questions: [],
        concerns: [],
        risks: [],
        actionItems: [],
        nextStep: "UNSET",
      },
    };
  }

  private proposalDraft(context: AgentTaskContext): AgentTaskResult {
    const companyName = String(context.companyName ?? "対象企業");
    const observedProblem = String(context.observedProblem ?? "");
    const businessImpact = String(context.businessImpact ?? "");
    const recommendedServices = (context.recommendedServices as Array<{ service: string; reason: string }> | undefined) ?? [];
    const expectedOutcome = String(context.expectedOutcome ?? "");

    return {
      summary: `${companyName}向けの提案書Draftを作成しました。`,
      data: {
        title: `${companyName}様向けご提案書`,
        executiveSummary: `${companyName}様の${observedProblem || "現状のWeb課題"}に対し、${recommendedServices.map((s) => s.service).join("・") || "Web改善施策"}をご提案します。`,
        clientChallenges: observedProblem ? [observedProblem] : [],
        goals: expectedOutcome ? [expectedOutcome] : [],
        recommendedSolution: recommendedServices.map((s) => `${s.service}: ${s.reason}`).join(" / "),
        scope: recommendedServices.map((s) => s.service),
        deliverables: recommendedServices.map((s) => `${s.service}施策の実行と月次レポート`),
        timeline: [
          { phase: "初期設定", period: "1ヶ月目" },
          { phase: "施策実行", period: "2〜3ヶ月目" },
          { phase: "効果測定・改善", period: "4ヶ月目以降" },
        ],
        kpis: ["問い合わせ数", "自然検索流入数"],
        assumptions: ["現在のサイト構成が維持されること"],
        exclusions: ["大規模なシステム開発は含まない"],
        risks: businessImpact ? [businessImpact] : [],
        nextStep: "お見積もりのご確認と契約条件のすり合わせ",
      },
    };
  }

  private negotiationAnalysis(context: AgentTaskContext): AgentTaskResult {
    const reactionCategory = String(context.reactionCategory ?? "UNKNOWN");
    const estimatedValue = Number(context.estimatedValue ?? 0);

    const responseByCategory: Record<string, { concern: string; response: string; alternatives: string[] }> = {
      PRICE_OBJECTION: {
        concern: "価格が想定より高いと感じている",
        response: "価値の再説明と、段階的導入プランの提示を推奨します。",
        alternatives: ["初期費用の分割", "契約期間を延ばして月額を下げる", "スコープを絞ったスモールスタート"],
      },
      SCOPE_CHANGE: {
        concern: "対応範囲の変更を希望している",
        response: "変更後スコープでの見積再作成が必要です。",
        alternatives: ["フェーズ分割での対応"],
      },
      TIMING_CHANGE: {
        concern: "開始時期の変更を希望している",
        response: "契約自体は締結し、開始日を調整することを推奨します。",
        alternatives: ["開始日を延期", "契約は締結し段階的に立ち上げ"],
      },
      COMPETITOR: {
        concern: "競合と比較検討している",
        response: "自社の差別化ポイント（実績・サポート体制）を再提示することを推奨します。",
        alternatives: [],
      },
      LEGAL_CONCERN: {
        concern: "契約条件に懸念がある",
        response: "契約書の該当条項を確認し、必要なら弁護士確認を挟むことを推奨します。",
        alternatives: [],
      },
      PROCUREMENT: {
        concern: "社内稟議・調達プロセスに時間がかかっている",
        response: "先方の稟議に必要な資料を追加提供することを推奨します。",
        alternatives: [],
      },
    };
    const info = responseByCategory[reactionCategory] ?? {
      concern: "不明な反応です。人間が内容を確認してください。",
      response: "人間が個別に判断してください。",
      alternatives: [],
    };

    return {
      summary: `交渉論点「${reactionCategory}」を整理しました。値引きの最終確定は行いません。`,
      data: {
        clientConcern: info.concern,
        importance: reactionCategory === "PRICE_OBJECTION" || reactionCategory === "COMPETITOR" ? "HIGH" : "MEDIUM",
        recommendedResponse: info.response,
        alternativesToDiscount: info.alternatives,
        // A ceiling only, never a confirmed discount — CEO must approve any actual figure (spec §44/§52).
        suggestedMaxDiscountRate: reactionCategory === "PRICE_OBJECTION" ? 0.1 : 0,
        estimatedValue,
        requiresCeoJudgment: true,
      },
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
