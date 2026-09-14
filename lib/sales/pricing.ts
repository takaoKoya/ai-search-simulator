/**
 * Estimate math against the Price Master (spec §40-45). This is
 * deliberately a pure arithmetic function, not an "AI generation" task —
 * there is nothing generative about it, and the whole point of a Price
 * Master is that the AI never invents a number (spec §41).
 */

export interface CatalogItem {
  code: string;
  name: string;
  standardPrice: number;
  setupFee: number;
  pricingModel: "one_time" | "monthly" | "usage";
}

export interface EstimateLineItem {
  catalogCode: string;
  service: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  amount: number;
}

export interface BuildEstimateInput {
  catalogItems: CatalogItem[];
  discountRate?: number; // 0-1, applied to the pre-tax subtotal
  taxRate?: number; // default 0.10
  estimatedHours?: number;
  hourlyCost?: number; // internal cost basis (never shown to the client)
}

export interface EstimateResult {
  lineItems: EstimateLineItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  setupFee: number;
  monthlyFee: number;
  annualValue: number;
  internalCost: number | null;
  marginAmount: number | null;
  marginRate: number | null;
}

export function buildEstimate(input: BuildEstimateInput): EstimateResult {
  const lineItems: EstimateLineItem[] = input.catalogItems.map((item) => ({
    catalogCode: item.code,
    service: item.name,
    quantity: 1,
    unitPrice: item.standardPrice,
    discount: 0,
    amount: item.standardPrice,
  }));

  const setupFee = input.catalogItems.reduce((sum, i) => sum + i.setupFee, 0);
  const monthlyFee = input.catalogItems.filter((i) => i.pricingModel === "monthly").reduce((sum, i) => sum + i.standardPrice, 0);
  const oneTimeFee = input.catalogItems.filter((i) => i.pricingModel === "one_time").reduce((sum, i) => sum + i.standardPrice, 0);

  const subtotal = lineItems.reduce((sum, i) => sum + i.amount, 0);
  const discountRate = input.discountRate ?? 0;
  const discount = Math.round(subtotal * discountRate);
  const taxRate = input.taxRate ?? 0.1;
  const taxableBase = subtotal - discount + setupFee + oneTimeFee;
  const tax = Math.round(taxableBase * taxRate);
  const total = taxableBase + tax;
  const annualValue = monthlyFee * 12;

  let internalCost: number | null = null;
  let marginAmount: number | null = null;
  let marginRate: number | null = null;
  if (input.estimatedHours != null && input.hourlyCost != null) {
    internalCost = Math.round(input.estimatedHours * input.hourlyCost);
    const netRevenue = subtotal - discount;
    marginAmount = netRevenue - internalCost;
    marginRate = netRevenue > 0 ? marginAmount / netRevenue : null;
  }

  return { lineItems, subtotal, discount, tax, total, setupFee, monthlyFee, annualValue, internalCost, marginAmount, marginRate };
}

/**
 * Matches a hypothesis-generated service name (e.g. "AIO/GEO", free text
 * from `TemplateProvider.salesHypothesis`) against the tenant's Price
 * Master. Returns null rather than guessing when nothing matches — spec
 * §40/§41: never invent a price for a service the catalog doesn't have.
 */
export function matchCatalogItem(serviceName: string, catalog: CatalogItem[]): CatalogItem | null {
  const normalized = serviceName.toUpperCase();
  if (normalized.includes("SEO") && !normalized.includes("AIO")) {
    return catalog.find((c) => c.code === "SEO") ?? null;
  }
  if (normalized.includes("AIO") || normalized.includes("GEO") || normalized.includes("AEO")) {
    return catalog.find((c) => c.code === "AIO") ?? null;
  }
  if (normalized.includes("CRO") || serviceName.includes("問い合わせ")) {
    return catalog.find((c) => c.code === "CRO") ?? null;
  }
  if (normalized.includes("RENEWAL") || serviceName.includes("刷新") || serviceName.includes("リニューアル")) {
    return catalog.find((c) => c.code === "Web Renewal") ?? null;
  }
  return catalog.find((c) => c.code.toUpperCase() === normalized || c.name.toUpperCase() === normalized) ?? null;
}

export type DiscountTier = "manager" | "ceo" | "ceo_with_reason";

export interface DiscountGuardResult {
  tier: DiscountTier;
  reasonRequired: boolean;
}

/**
 * Discount approval tiers (spec §44). This vertical slice routes every
 * proposal approval to the single CEO Inbox regardless of tier (no
 * manager-level approval queue exists yet — see README known limitations),
 * but the guard result is still computed and shown on the approval so a CEO
 * can see which threshold was crossed and whether a reason is mandatory.
 */
export function evaluateDiscountGuard(discountRate: number): DiscountGuardResult {
  if (discountRate <= 0.05) return { tier: "manager", reasonRequired: false };
  if (discountRate <= 0.1) return { tier: "ceo", reasonRequired: false };
  return { tier: "ceo_with_reason", reasonRequired: true };
}
