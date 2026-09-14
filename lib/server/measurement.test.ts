import { describe, expect, it } from "vitest";
import { classifyKpiStatus, computeChange, computeTargetGap, detectAnomaly, evaluateEffect, resolveMeasurementStartDelayDays } from "@/lib/server/measurement";

describe("computeChange", () => {
  it("computes absolute and percentage change normally", () => {
    const result = computeChange(10, 17);
    expect(result.absoluteChange).toBe(7);
    expect(result.percentageChange).toBeCloseTo(0.7, 5);
  });

  it("never divides by zero — baseline 0 yields only an absolute change (spec §18)", () => {
    const result = computeChange(0, 5);
    expect(result.absoluteChange).toBe(5);
    expect(result.percentageChange).toBeNull();
    expect(Number.isFinite(result.percentageChange ?? 0)).toBe(true);
  });

  it("returns nulls when a value is missing, never fabricating 0", () => {
    expect(computeChange(null, 5)).toEqual({ absoluteChange: null, percentageChange: null, hasBaseline: false });
    expect(computeChange(10, null)).toEqual({ absoluteChange: null, percentageChange: null, hasBaseline: true });
  });
});

describe("computeTargetGap", () => {
  it("computes the gap and achievement ratio", () => {
    const result = computeTargetGap(17, 20);
    expect(result.targetGap).toBe(3);
    expect(result.achievementRatio).toBeCloseTo(0.85, 5);
  });

  it("returns null achievementRatio when target is 0", () => {
    expect(computeTargetGap(5, 0).achievementRatio).toBeNull();
  });
});

describe("classifyKpiStatus", () => {
  it("classifies CRITICAL when below the critical threshold regardless of target", () => {
    const status = classifyKpiStatus({ current: 3, target: 20, warningThreshold: 8, criticalThreshold: 5, direction: "HIGHER_IS_BETTER" });
    expect(status).toBe("CRITICAL");
  });

  it("classifies ON_TARGET once the target is met", () => {
    const status = classifyKpiStatus({ current: 20, target: 20, warningThreshold: 8, criticalThreshold: 5, direction: "HIGHER_IS_BETTER" });
    expect(status).toBe("ON_TARGET");
  });

  it("returns NO_DATA when current is missing", () => {
    expect(classifyKpiStatus({ current: null, target: 20, warningThreshold: null, criticalThreshold: null, direction: "HIGHER_IS_BETTER" })).toBe("NO_DATA");
  });
});

describe("evaluateEffect — Test Case A (partial success)", () => {
  it("evaluates Organic CV 10 -> 17 against target 20 as PARTIAL_SUCCESS", () => {
    const result = evaluateEffect({
      baseline: 10,
      current: 17,
      target: 20,
      direction: "HIGHER_IS_BETTER",
      hasSufficientData: true,
      dataQuality: "GOOD",
    });
    expect(result.evaluation).toBe("PARTIAL_SUCCESS");
    expect(result.confidence).toBe("HIGH");
    expect(result.targetGap.targetGap).toBe(3);
  });
});

describe("evaluateEffect — Test Case B (insufficient data)", () => {
  it("never states a definitive result without enough data", () => {
    const result = evaluateEffect({
      baseline: 10,
      current: 12,
      target: 20,
      direction: "HIGHER_IS_BETTER",
      hasSufficientData: false,
      dataQuality: "UNKNOWN",
    });
    expect(result.evaluation).toBe("INSUFFICIENT_DATA");
    expect(result.confidence).toBeNull();
  });
});

describe("evaluateEffect — Test Case C (KPI worsened)", () => {
  it("evaluates Organic CV 10 -> 6 as NEGATIVE", () => {
    const result = evaluateEffect({
      baseline: 10,
      current: 6,
      target: 20,
      direction: "HIGHER_IS_BETTER",
      hasSufficientData: true,
      dataQuality: "GOOD",
    });
    expect(result.evaluation).toBe("NEGATIVE");
  });

  it("flags a critical anomaly for the same drop", () => {
    expect(detectAnomaly({ baseline: 10, current: 6, direction: "HIGHER_IS_BETTER" })).toBe("CRITICAL");
  });
});

describe("evaluateEffect — SUCCESS and confidence caps", () => {
  it("reaches SUCCESS once the target is fully achieved", () => {
    const result = evaluateEffect({ baseline: 10, current: 22, target: 20, direction: "HIGHER_IS_BETTER", hasSufficientData: true, dataQuality: "GOOD" });
    expect(result.evaluation).toBe("SUCCESS");
  });

  it("caps confidence at MEDIUM when a confounding factor overlaps the window", () => {
    const result = evaluateEffect({
      baseline: 10,
      current: 22,
      target: 20,
      direction: "HIGHER_IS_BETTER",
      hasSufficientData: true,
      dataQuality: "GOOD",
      hasConfoundingFactor: true,
    });
    expect(result.confidence).toBe("MEDIUM");
  });

  it("never claims a real effect for noise below the significance threshold", () => {
    const result = evaluateEffect({ baseline: 100, current: 101, target: 200, direction: "HIGHER_IS_BETTER", hasSufficientData: true, dataQuality: "GOOD" });
    expect(result.evaluation).toBe("NO_SIGNIFICANT_CHANGE");
  });
});

describe("detectAnomaly", () => {
  it("returns null for an improving move even if large", () => {
    expect(detectAnomaly({ baseline: 10, current: 20, direction: "HIGHER_IS_BETTER" })).toBeNull();
  });

  it("is direction-aware: a rise in CPA (LOWER_IS_BETTER) is the bad direction", () => {
    expect(detectAnomaly({ baseline: 100, current: 135, direction: "LOWER_IS_BETTER" })).toBe("HIGH");
  });

  it("returns null when baseline is 0 (cannot compute a % move)", () => {
    expect(detectAnomaly({ baseline: 0, current: 5, direction: "HIGHER_IS_BETTER" })).toBeNull();
  });
});

describe("resolveMeasurementStartDelayDays", () => {
  it("matches the spec §4 table", () => {
    expect(resolveMeasurementStartDelayDays("seo")).toBe(14);
    expect(resolveMeasurementStartDelayDays("content")).toBe(28);
    expect(resolveMeasurementStartDelayDays("ads")).toBe(7);
    expect(resolveMeasurementStartDelayDays(null)).toBe(14);
  });
});
