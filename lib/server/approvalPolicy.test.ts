import { describe, expect, it } from "vitest";
import { computeApprovalSteps, matchesConditions, selectApprovalPolicy, type ApprovalPolicyRow } from "@/lib/server/approvalPolicy";

const POLICIES: ApprovalPolicyRow[] = [
  { code: "sales_send", description: "", conditions: {}, steps: [{ role: "manager" }], is_active: true } as ApprovalPolicyRow,
  { code: "estimate_amount_low", conditions: { amountLt: 300000 }, steps: [{ role: "manager" }], is_active: true } as ApprovalPolicyRow,
  { code: "estimate_amount_high", conditions: { amountGte: 300000 }, steps: [{ role: "manager" }, { role: "ceo" }], is_active: true } as ApprovalPolicyRow,
  { code: "discount_low", conditions: { discountRateLte: 0.05 }, steps: [{ role: "manager" }], is_active: true } as ApprovalPolicyRow,
  { code: "discount_high", conditions: { discountRateGt: 0.05 }, steps: [{ role: "ceo" }], is_active: true } as ApprovalPolicyRow,
  { code: "deal_won", conditions: {}, steps: [{ role: "ceo" }], is_active: true } as ApprovalPolicyRow,
  { code: "inactive_family", conditions: {}, steps: [{ role: "ceo" }], is_active: false } as ApprovalPolicyRow,
];

describe("matchesConditions", () => {
  it("always matches empty conditions", () => {
    expect(matchesConditions({}, {})).toBe(true);
    expect(matchesConditions(undefined, { amount: 1 })).toBe(true);
  });

  it("matches amountLt/amountGte thresholds", () => {
    expect(matchesConditions({ amountLt: 300000 }, { amount: 100000 })).toBe(true);
    expect(matchesConditions({ amountLt: 300000 }, { amount: 300000 })).toBe(false);
    expect(matchesConditions({ amountGte: 300000 }, { amount: 300000 })).toBe(true);
    expect(matchesConditions({ amountGte: 300000 }, { amount: 299999 })).toBe(false);
  });

  it("does not match a threshold condition when the relevant context value is missing", () => {
    expect(matchesConditions({ amountLt: 300000 }, {})).toBe(false);
  });

  it("matches discountRateLte/discountRateGt thresholds", () => {
    expect(matchesConditions({ discountRateLte: 0.05 }, { discountRate: 0.05 })).toBe(true);
    expect(matchesConditions({ discountRateLte: 0.05 }, { discountRate: 0.06 })).toBe(false);
    expect(matchesConditions({ discountRateGt: 0.05 }, { discountRate: 0.06 })).toBe(true);
  });
});

describe("selectApprovalPolicy", () => {
  it("selects the exact-code policy for a prefix with no threshold family", () => {
    const match = selectApprovalPolicy(POLICIES, "sales_send", {});
    expect(match?.code).toBe("sales_send");
  });

  it("selects the matching member of a threshold family", () => {
    expect(selectApprovalPolicy(POLICIES, "estimate_amount", { amount: 100000 })?.code).toBe("estimate_amount_low");
    expect(selectApprovalPolicy(POLICIES, "estimate_amount", { amount: 500000 })?.code).toBe("estimate_amount_high");
  });

  it("ignores inactive policies", () => {
    expect(selectApprovalPolicy(POLICIES, "inactive_family", {})).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(selectApprovalPolicy([], "sales_send", {})).toBeNull();
  });
});

describe("computeApprovalSteps", () => {
  it("returns manager-only steps for a low-amount estimate with no discount", () => {
    const { steps, policyCodes } = computeApprovalSteps(POLICIES, [
      { codePrefix: "estimate_amount", context: { amount: 100000 } },
      { codePrefix: "discount", context: { discountRate: 0 } },
    ]);
    expect(steps).toEqual([{ role: "manager", status: "PENDING" }]);
    expect(policyCodes).toEqual(["estimate_amount_low", "discount_low"]);
  });

  it("orders manager before ceo and dedupes when both families require ceo", () => {
    const { steps } = computeApprovalSteps(POLICIES, [
      { codePrefix: "estimate_amount", context: { amount: 500000 } },
      { codePrefix: "discount", context: { discountRate: 0.1 } },
    ]);
    expect(steps).toEqual([
      { role: "manager", status: "PENDING" },
      { role: "ceo", status: "PENDING" },
    ]);
  });

  it("returns empty steps when no policy is configured (legacy fallback signal)", () => {
    const { steps, policyCodes } = computeApprovalSteps([], [{ codePrefix: "sales_send", context: {} }]);
    expect(steps).toEqual([]);
    expect(policyCodes).toEqual([]);
  });
});
