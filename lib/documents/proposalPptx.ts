import PptxGenJS from "pptxgenjs";
import { formatYen, type ProposalDocumentInput } from "@/lib/documents/proposalDocument";

/**
 * Real PPTX rendering via pptxgenjs — same Source-of-Truth input as the PDF
 * renderer (lib/documents/proposalPdf.ts). One slide per section rather
 * than one long page, since a slide deck reads differently from a document,
 * but the content itself is identical to what the PDF shows.
 */
export async function renderProposalPptx(input: ProposalDocumentInput): Promise<Buffer> {
  const pres = new PptxGenJS();

  const titleSlide = pres.addSlide();
  titleSlide.addText(input.title, { x: 0.5, y: 1.5, w: 9, h: 1.5, fontSize: 28, bold: true, align: "center" });
  titleSlide.addText(`${input.companyName} 御中`, { x: 0.5, y: 3, w: 9, h: 0.6, fontSize: 14, align: "center", color: "555555" });

  bulletSlide(pres, "エグゼクティブサマリー", [input.executiveSummary]);
  if (input.clientChallenges.length > 0) bulletSlide(pres, "現状の課題", input.clientChallenges);
  if (input.goals.length > 0) bulletSlide(pres, "目標", input.goals);
  bulletSlide(pres, "ご提案内容", [input.recommendedSolution]);
  if (input.scope.length > 0) bulletSlide(pres, "スコープ", input.scope);
  if (input.deliverables.length > 0) bulletSlide(pres, "成果物", input.deliverables);
  if (input.timeline.length > 0) bulletSlide(pres, "スケジュール", input.timeline.map((t) => `${t.phase} — ${t.period}`));
  if (input.kpis.length > 0) bulletSlide(pres, "KPI", input.kpis);

  if (input.estimate) {
    const lines = [
      ...input.estimate.lineItems.map((item) => `${item.service}: ${formatYen(item.amount)}`),
      `小計: ${formatYen(input.estimate.subtotal)}`,
      ...(input.estimate.discount > 0 ? [`値引き: -${formatYen(input.estimate.discount)}`] : []),
      `消費税: ${formatYen(input.estimate.tax)}`,
      `合計: ${formatYen(input.estimate.total)}`,
    ];
    bulletSlide(pres, "お見積り", lines);
  }

  bulletSlide(pres, "次のステップ", [input.nextStep]);

  const output = await pres.write({ outputType: "nodebuffer" });
  return output as Buffer;
}

function bulletSlide(pres: PptxGenJS, title: string, bullets: string[]): void {
  const slide = pres.addSlide();
  slide.addText(title, { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 22, bold: true });
  slide.addText(
    bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
    { x: 0.5, y: 1.3, w: 9, h: 5, fontSize: 14, valign: "top" }
  );
}
