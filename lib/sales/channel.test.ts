import { describe, expect, it } from "vitest";
import { recommendChannel } from "@/lib/sales/channel";

describe("recommendChannel", () => {
  it("recommends EMAIL with a synthetic test address in test mode with a known domain", () => {
    const result = recommendChannel({ normalizedDomain: "example.jp", websiteUrl: "https://example.jp", testMode: true });
    expect(result.channel).toBe("EMAIL");
    expect(result.availableContact).toBe("info@example.jp");
    expect(result.confidence).toBe("HIGH");
  });

  it("never invents a real email address outside test mode", () => {
    const result = recommendChannel({ normalizedDomain: "example.jp", websiteUrl: "https://example.jp", testMode: false });
    expect(result.channel).toBe("CONTACT_FORM");
    expect(result.availableContact).toBeNull();
    expect(result.risk).toBeTruthy();
  });

  it("falls back to OTHER with no usable contact route at all", () => {
    const result = recommendChannel({ normalizedDomain: null, websiteUrl: null, testMode: false });
    expect(result.channel).toBe("OTHER");
    expect(result.availableContact).toBeNull();
  });
});
