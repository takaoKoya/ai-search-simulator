import PDFDocument from "pdfkit";
import { formatYen, type ProposalDocumentInput } from "@/lib/documents/proposalDocument";

/**
 * Real PDF rendering via pdfkit (no external network dependency, no HTML/
 * headless-browser step) — a pure function of `ProposalDocumentInput`, so
 * re-rendering the same content_json always produces byte-different-but-
 * content-identical output (pdfkit timestamps its own metadata), never a
 * different document.
 */
export function renderProposalPdf(input: ProposalDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, info: { Title: input.title } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text(input.title, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#555555").text(`${input.companyName} 御中`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    section(doc, "エグゼクティブサマリー", [input.executiveSummary]);
    if (input.clientChallenges.length > 0) section(doc, "現状の課題", input.clientChallenges);
    if (input.goals.length > 0) section(doc, "目標", input.goals);
    section(doc, "ご提案内容", [input.recommendedSolution]);
    if (input.scope.length > 0) bulletSection(doc, "スコープ", input.scope);
    if (input.deliverables.length > 0) bulletSection(doc, "成果物", input.deliverables);

    if (input.timeline.length > 0) {
      heading(doc, "スケジュール");
      for (const t of input.timeline) {
        doc.fontSize(10).text(`${t.phase} — ${t.period}`);
      }
      doc.moveDown(0.8);
    }

    if (input.kpis.length > 0) bulletSection(doc, "KPI", input.kpis);

    if (input.estimate) {
      heading(doc, "お見積り");
      for (const item of input.estimate.lineItems) {
        doc.fontSize(10).text(`${item.service}    ${formatYen(item.amount)}`);
      }
      doc.moveDown(0.3);
      doc.fontSize(10).text(`小計: ${formatYen(input.estimate.subtotal)}`);
      if (input.estimate.discount > 0) doc.text(`値引き: -${formatYen(input.estimate.discount)}`);
      doc.text(`消費税: ${formatYen(input.estimate.tax)}`);
      doc.fontSize(12).text(`合計: ${formatYen(input.estimate.total)}`, { underline: true });
      doc.moveDown(0.8);
    }

    section(doc, "次のステップ", [input.nextStep]);

    doc.end();
  });
}

function heading(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(14).fillColor("#1a1a1a").text(title);
  doc.fillColor("#000000");
  doc.moveDown(0.3);
}

function section(doc: PDFKit.PDFDocument, title: string, paragraphs: string[]): void {
  heading(doc, title);
  for (const p of paragraphs) {
    doc.fontSize(10).text(p);
  }
  doc.moveDown(0.8);
}

function bulletSection(doc: PDFKit.PDFDocument, title: string, items: string[]): void {
  heading(doc, title);
  for (const item of items) {
    doc.fontSize(10).text(`• ${item}`);
  }
  doc.moveDown(0.8);
}
