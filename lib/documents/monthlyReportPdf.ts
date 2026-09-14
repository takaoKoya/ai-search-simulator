import PDFDocument from "pdfkit";
import { formatKpiValue, formatPercent, type MonthlyReportDocumentInput } from "@/lib/documents/monthlyReportDocument";

/**
 * Real PDF rendering via pdfkit (spec §51), pure function of
 * `MonthlyReportDocumentInput` — same approach as proposalPdf.ts.
 */
export function renderMonthlyReportPdf(input: MonthlyReportDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, info: { Title: `${input.companyName} 月次レポート ${input.periodLabel}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text(`月次レポート ${input.periodLabel}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#555555").text(`${input.companyName} 御中`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    heading(doc, "エグゼクティブサマリー");
    for (const line of input.executiveSummary) doc.fontSize(10).text(`• ${line}`);
    doc.moveDown(0.8);

    heading(doc, "KPIサマリー");
    for (const row of input.kpiTable) {
      doc
        .fontSize(9)
        .text(
          `${row.metric}: 実績 ${formatKpiValue(row.actual, row.unit)} / 目標 ${formatKpiValue(row.target, row.unit)} / 前月比 ${formatPercent(row.momPercent)} / ${row.status}${row.dataQuality !== "GOOD" ? ` (データ品質: ${row.dataQuality})` : ""}`
        );
    }
    doc.moveDown(0.8);

    for (const section of input.narrativeSections) {
      heading(doc, section.title);
      doc.fontSize(10).text(section.body);
      doc.moveDown(0.6);
    }

    if (input.dataQualityNotes.length > 0) {
      heading(doc, "データ品質に関する注記");
      for (const note of input.dataQualityNotes) doc.fontSize(9).fillColor("#8a6d00").text(`⚠ ${note}`);
      doc.fillColor("#000000");
      doc.moveDown(0.6);
    }

    if (input.expansionOpportunities.length > 0) {
      heading(doc, "Expansion Opportunities");
      for (const item of input.expansionOpportunities) doc.fontSize(10).text(`• ${item}`);
      doc.moveDown(0.6);
    }

    if (input.sources.length > 0) {
      heading(doc, "Sources");
      for (const s of input.sources) doc.fontSize(8).fillColor("#666666").text(`${s.label}: ${s.reference}`);
      doc.fillColor("#000000");
    }

    doc.end();
  });
}

function heading(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(13).fillColor("#1a1a1a").text(title);
  doc.fillColor("#000000");
  doc.moveDown(0.3);
}
