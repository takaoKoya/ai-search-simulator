import { describe, it, expect } from "vitest";
import { guardCtaForArticleType } from "./ctaGuard";

describe("guardCtaForArticleType", () => {
  it("無料noteからPRODUCTへの直接誘導はPAID_NOTEへ差し替える", () => {
    expect(guardCtaForArticleType("FREE", "PRODUCT")).toBe("PAID_NOTE");
  });

  it("有料noteからPRODUCTへの誘導はそのまま許可する", () => {
    expect(guardCtaForArticleType("PAID", "PRODUCT")).toBe("PRODUCT");
  });

  it("PRODUCT以外のCTAはFREEでもそのまま通す", () => {
    expect(guardCtaForArticleType("FREE", "FOLLOW")).toBe("FOLLOW");
    expect(guardCtaForArticleType("FREE", "PAID_NOTE")).toBe("PAID_NOTE");
  });
});
