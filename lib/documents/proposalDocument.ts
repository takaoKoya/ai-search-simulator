/**
 * Shared input shape for both PDF and PPTX rendering (spec §37-38): the
 * structured content_json on `proposals`/`estimates` IS the Source of
 * Truth, and both renderers read only from this shape — never anything
 * regenerated or re-derived at render time — so a PDF and a PPTX of the
 * same version always agree, and neither can drift from what was actually
 * approved.
 */
export interface ProposalDocumentInput {
  companyName: string;
  title: string;
  executiveSummary: string;
  clientChallenges: string[];
  goals: string[];
  recommendedSolution: string;
  scope: string[];
  deliverables: string[];
  timeline: Array<{ phase: string; period: string }>;
  kpis: string[];
  nextStep: string;
  estimate: {
    lineItems: Array<{ service: string; unitPrice: number; amount: number }>;
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
  } | null;
}

export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}
