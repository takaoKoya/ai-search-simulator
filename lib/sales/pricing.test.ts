import { describe, expect, it } from "vitest";
import { buildEstimate, evaluateDiscountGuard, matchCatalogItem, type CatalogItem } from "@/lib/sales/pricing";

const seo: CatalogItem = { code: "SEO", name: "SEO Standard", standardPrice: 248000, setupFee: 0, pricingModel: "monthly" };
const aio: CatalogItem = { code: "AIO", name: "AIO/GEO Standard", standardPrice: 198000, setupFee: 50000, pricingModel: "monthly" };
const renewal: CatalogItem = { code: "Web Renewal", name: "Webサイトリニューアル", standardPrice: 980000, setupFee: 0, pricingModel: "one_time" };

describe("buildEstimate", () => {
  it("sums catalog items without ever inventing a price", () => {
    const result = buildEstimate({ catalogItems: [seo, aio] });
    expect(result.subtotal).toBe(248000 + 198000);
    expect(result.setupFee).toBe(50000);
    expect(result.monthlyFee).toBe(248000 + 198000);
    expect(result.annualValue).toBe((248000 + 198000) * 12);
  });

  it("applies discount before tax, and computes tax on the taxable base", () => {
    const result = buildEstimate({ catalogItems: [seo], discountRate: 0.1, taxRate: 0.1 });
    expect(result.discount).toBe(24800);
    const taxable = 248000 - 24800;
    expect(result.tax).toBe(Math.round(taxable * 0.1));
    expect(result.total).toBe(taxable + result.tax);
  });

  it("includes one-time items' setup/price in the taxable base but not monthly_fee", () => {
    const result = buildEstimate({ catalogItems: [renewal] });
    expect(result.monthlyFee).toBe(0);
    expect(result.subtotal).toBe(980000);
  });

  it("computes margin only when internal cost inputs are supplied, and never exposes it otherwise", () => {
    const withoutCost = buildEstimate({ catalogItems: [seo] });
    expect(withoutCost.marginAmount).toBeNull();
    expect(withoutCost.marginRate).toBeNull();

    const withCost = buildEstimate({ catalogItems: [seo], estimatedHours: 20, hourlyCost: 5000 });
    expect(withCost.internalCost).toBe(100000);
    expect(withCost.marginAmount).toBe(248000 - 100000);
    expect(withCost.marginRate).toBeCloseTo((248000 - 100000) / 248000, 5);
  });
});

describe("matchCatalogItem", () => {
  const catalog = [seo, aio, { code: "CRO", name: "CRO Standard", standardPrice: 158000, setupFee: 0, pricingModel: "monthly" as const }, renewal];

  it("matches AIO/GEO/AEO free-text service names to the AIO catalog entry", () => {
    expect(matchCatalogItem("AIO/GEO", catalog)?.code).toBe("AIO");
  });

  it("matches SEO without matching AIO", () => {
    expect(matchCatalogItem("SEO", catalog)?.code).toBe("SEO");
  });

  it("never invents a match for an unknown service", () => {
    expect(matchCatalogItem("ブロックチェーン導入支援", catalog)).toBeNull();
  });
});

describe("evaluateDiscountGuard", () => {
  it("requires no special reason for a small discount", () => {
    expect(evaluateDiscountGuard(0.03)).toEqual({ tier: "manager", reasonRequired: false });
  });

  it("escalates to CEO without mandatory reason in the middle band", () => {
    expect(evaluateDiscountGuard(0.08)).toEqual({ tier: "ceo", reasonRequired: false });
  });

  it("requires a mandatory reason for a large discount", () => {
    const result = evaluateDiscountGuard(0.15);
    expect(result.tier).toBe("ceo_with_reason");
    expect(result.reasonRequired).toBe(true);
  });
});
