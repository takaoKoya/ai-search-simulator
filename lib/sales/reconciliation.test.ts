import { describe, expect, it } from "vitest";
import { reconcileProposalAndEstimate } from "@/lib/sales/reconciliation";
import type { CatalogItem, EstimateLineItem } from "@/lib/sales/pricing";

const CATALOG: CatalogItem[] = [
  { code: "SEO", name: "SEO Standard", standardPrice: 248000, setupFee: 0, pricingModel: "monthly" },
  { code: "AIO", name: "AIO/GEO Standard", standardPrice: 198000, setupFee: 50000, pricingModel: "monthly" },
  { code: "CRO", name: "CRO Standard", standardPrice: 158000, setupFee: 0, pricingModel: "monthly" },
];

function lineItem(catalogCode: string, service: string): EstimateLineItem {
  return { catalogCode, service, quantity: 1, unitPrice: 100000, discount: 0, amount: 100000 };
}

describe("reconcileProposalAndEstimate", () => {
  it("returns MATCH when every scope item is priced and nothing extra is priced", () => {
    const result = reconcileProposalAndEstimate({
      proposalScope: ["SEO", "AIO"],
      estimateLineItems: [lineItem("SEO", "SEO Standard"), lineItem("AIO", "AIO/GEO Standard")],
      catalog: CATALOG,
    });
    expect(result.status).toBe("MATCH");
    expect(result.issues).toEqual([]);
  });

  it("returns WARNING when a scope item is unpriced but others match", () => {
    const result = reconcileProposalAndEstimate({
      proposalScope: ["SEO", "CRO"],
      estimateLineItems: [lineItem("SEO", "SEO Standard")],
      catalog: CATALOG,
    });
    expect(result.status).toBe("WARNING");
    expect(result.issues[0]).toContain("CRO");
  });

  it("returns WARNING when the estimate prices something outside the stated scope", () => {
    const result = reconcileProposalAndEstimate({
      proposalScope: ["SEO"],
      estimateLineItems: [lineItem("SEO", "SEO Standard"), lineItem("CRO", "CRO Standard")],
      catalog: CATALOG,
    });
    expect(result.status).toBe("WARNING");
    expect(result.issues.some((i) => i.includes("CRO"))).toBe(true);
  });

  it("returns BLOCKING_MISMATCH when nothing in the estimate corresponds to the scope", () => {
    const result = reconcileProposalAndEstimate({
      proposalScope: ["SEO", "AIO"],
      estimateLineItems: [],
      catalog: CATALOG,
    });
    expect(result.status).toBe("BLOCKING_MISMATCH");
  });

  it("returns BLOCKING_MISMATCH when the proposal has no scope at all", () => {
    const result = reconcileProposalAndEstimate({ proposalScope: [], estimateLineItems: [lineItem("SEO", "SEO Standard")], catalog: CATALOG });
    expect(result.status).toBe("BLOCKING_MISMATCH");
  });
});
