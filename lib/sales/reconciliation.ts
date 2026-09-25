import { matchCatalogItem, type CatalogItem, type EstimateLineItem } from "@/lib/sales/pricing";

export type ReconciliationStatus = "MATCH" | "WARNING" | "BLOCKING_MISMATCH";

export interface ReconciliationResult {
  status: ReconciliationStatus;
  issues: string[];
}

/**
 * Reconciliation Engine (spec §46-48): compares what the Proposal promises
 * (`scope`) against what the Estimate actually prices (`line_items`), using
 * the exact same catalog-matching heuristic (matchCatalogItem) the Estimate
 * generation step used to decide what to price — so "does this scope item
 * have a price" is checked the same way it was decided at generation time.
 * Every gap becomes a named issue string; nothing fails silently.
 *
 * - BLOCKING_MISMATCH: nothing in the estimate corresponds to the
 *   proposal's scope at all (would deliver a priced document for services
 *   the client was never told about, or promise services with no price).
 * - WARNING: partial overlap — some scope items are unpriced, or the
 *   estimate prices something outside the stated scope.
 * - MATCH: every scope item has a corresponding priced line item and
 *   vice versa.
 */
export function reconcileProposalAndEstimate(params: { proposalScope: string[]; estimateLineItems: EstimateLineItem[]; catalog: CatalogItem[] }): ReconciliationResult {
  const issues: string[] = [];
  const pricedCodes = new Set(params.estimateLineItems.map((li) => li.catalogCode));

  const unpriced = params.proposalScope.filter((scopeItem) => {
    const match = matchCatalogItem(scopeItem, params.catalog);
    return !match || !pricedCodes.has(match.code);
  });
  if (unpriced.length > 0) {
    issues.push(`提案書のスコープに含まれるが見積に価格がない項目: ${unpriced.join(", ")}`);
  }

  const scopeCodes = new Set(params.proposalScope.map((s) => matchCatalogItem(s, params.catalog)?.code).filter((c): c is string => Boolean(c)));
  const extraPriced = params.estimateLineItems.filter((li) => !scopeCodes.has(li.catalogCode)).map((li) => li.service);
  if (extraPriced.length > 0) {
    issues.push(`見積に含まれるが提案書のスコープに記載がない項目: ${extraPriced.join(", ")}`);
  }

  if (params.proposalScope.length === 0 || params.estimateLineItems.length === 0 || unpriced.length === params.proposalScope.length) {
    return { status: "BLOCKING_MISMATCH", issues: issues.length > 0 ? issues : ["見積にスコープと一致する項目が一つもありません"] };
  }
  if (issues.length > 0) {
    return { status: "WARNING", issues };
  }
  return { status: "MATCH", issues: [] };
}
