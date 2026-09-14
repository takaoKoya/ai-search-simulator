import { describe, expect, it } from "vitest";
import { renderProposalPdf } from "@/lib/documents/proposalPdf";
import { renderProposalPptx } from "@/lib/documents/proposalPptx";
import type { ProposalDocumentInput } from "@/lib/documents/proposalDocument";

const SAMPLE_INPUT: ProposalDocumentInput = {
  companyName: "テスト株式会社",
  title: "テスト株式会社様向けご提案書",
  executiveSummary: "貴社の課題に対しSEO/AIO施策をご提案します。",
  clientChallenges: ["自然検索流入の減少"],
  goals: ["問い合わせ数を月30件に増やす"],
  recommendedSolution: "SEO: 検索順位改善 / AIO: AI検索での露出強化",
  scope: ["SEO", "AIO"],
  deliverables: ["SEO施策の実行と月次レポート", "AIO施策の実行と月次レポート"],
  timeline: [
    { phase: "初期設定", period: "1ヶ月目" },
    { phase: "施策実行", period: "2〜3ヶ月目" },
  ],
  kpis: ["問い合わせ数", "自然検索流入数"],
  nextStep: "お見積もりのご確認と契約条件のすり合わせ",
  estimate: {
    lineItems: [{ service: "SEO Standard", unitPrice: 248000, amount: 248000 }],
    subtotal: 248000,
    discount: 0,
    tax: 24800,
    total: 272800,
  },
};

describe("renderProposalPdf", () => {
  it("produces a real, non-empty PDF (starts with the %PDF magic bytes)", async () => {
    const buffer = await renderProposalPdf(SAMPLE_INPUT);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders even when there is no estimate yet", async () => {
    const buffer = await renderProposalPdf({ ...SAMPLE_INPUT, estimate: null });
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});

describe("renderProposalPptx", () => {
  it("produces a real, non-empty PPTX (a zip archive — starts with the PK magic bytes)", async () => {
    const buffer = await renderProposalPptx(SAMPLE_INPUT);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("renders even when there is no estimate yet", async () => {
    const buffer = await renderProposalPptx({ ...SAMPLE_INPUT, estimate: null });
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });
});
