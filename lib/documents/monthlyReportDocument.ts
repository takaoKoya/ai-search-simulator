/**
 * Shared input shape for Monthly Report rendering (Growth Loop spec §36-41):
 * `monthly_reports.content_json` IS the Source of Truth — the PDF renderer
 * reads only from this shape, never re-derived from live KPI data at render
 * time, so a delivered report's numbers never silently drift even if the
 * underlying kpi_snapshots later change.
 */
export interface MonthlyReportKpiRow {
  metric: string;
  unit: string | null;
  target: number | null;
  actual: number | null;
  gap: number | null;
  momPercent: number | null;
  status: string; // KpiStatus
  dataQuality: string;
}

export interface MonthlyReportNarrativeSection {
  title: string;
  body: string;
}

export interface MonthlyReportSourceRef {
  label: string;
  reference: string;
}

export interface MonthlyReportDocumentInput {
  companyName: string;
  periodLabel: string;
  executiveSummary: string[];
  kpiTable: MonthlyReportKpiRow[];
  narrativeSections: MonthlyReportNarrativeSection[];
  dataQualityNotes: string[];
  expansionOpportunities: string[];
  sources: MonthlyReportSourceRef[];
}

export function formatKpiValue(value: number | null, unit: string | null): string {
  if (value == null) return "NO_DATA";
  return unit ? `${value.toLocaleString("ja-JP")}${unit}` : value.toLocaleString("ja-JP");
}

export function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${Math.round(value * 1000) / 10}%`;
}
