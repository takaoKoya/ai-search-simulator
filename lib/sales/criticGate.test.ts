import { describe, expect, it } from "vitest";
import { decideCriticVerdict } from "@/lib/sales/criticGate";

describe("decideCriticVerdict", () => {
  it("passes through immediately when the review passed", () => {
    const decision = decideCriticVerdict(true, 0);
    expect(decision).toEqual({ verdict: "PASS", shouldRetry: false, nextRevisionCount: 0 });
  });

  it("requests a retry while under the revision cap", () => {
    const decision = decideCriticVerdict(false, 1);
    expect(decision.verdict).toBe("REVISION_REQUIRED");
    expect(decision.shouldRetry).toBe(true);
    expect(decision.nextRevisionCount).toBe(2);
  });

  it("stops retrying once the cap is reached and forwards to the human instead of looping forever", () => {
    const decision = decideCriticVerdict(false, 3, 3);
    expect(decision.verdict).toBe("REVISION_REQUIRED");
    expect(decision.shouldRetry).toBe(false);
    expect(decision.nextRevisionCount).toBe(3);
  });

  it("never exceeds the configured max revisions across repeated failures", () => {
    let revisionCount = 0;
    for (let i = 0; i < 10; i += 1) {
      const decision = decideCriticVerdict(false, revisionCount, 3);
      revisionCount = decision.nextRevisionCount;
    }
    expect(revisionCount).toBe(3);
  });
});
