import { describe, it, expect } from "vitest";
import {
  calcCurrentStatus,
  calcRecoveryLine,
  calcScenario,
  calcAll,
  getJudgment,
} from "./calc";

const BASE = {
  monthlyInquiries: 20,
  avgOrderValue: 300000,
  grossMarginRate: 0.5,
  conversionRate: 0.3,
  monthlyAdSpend: 0,
  webRevenueRatio: 0.5,
  monthlyFee: 300000,
  initialFee: 0,
  contractMonths: 6,
  improvementRateConservative: 0.1,
  improvementRateStandard: 0.2,
  improvementRateAggressive: 0.3,
};

describe("calcCurrentStatus", () => {
  it("1. 標準ケース: 問い合わせ20件、単価30万円、粗利50%、受注率30%", () => {
    const r = calcCurrentStatus(BASE);
    expect(r.monthlyOrders).toBeCloseTo(6);
    expect(r.monthlyRevenue).toBeCloseTo(1800000);
    expect(r.monthlyGrossProfit).toBeCloseTo(900000);
  });

  it("2. 粗利率が低いケース（10%）", () => {
    const r = calcCurrentStatus({ ...BASE, grossMarginRate: 0.1 });
    expect(r.monthlyGrossProfit).toBeCloseTo(180000);
  });

  it("3. 問い合わせ数が少ないケース（3件）", () => {
    const r = calcCurrentStatus({ ...BASE, monthlyInquiries: 3 });
    expect(r.monthlyOrders).toBeCloseTo(0.9);
    expect(r.monthlyRevenue).toBeCloseTo(270000);
  });

  it("8. 受注率100%のケース", () => {
    const r = calcCurrentStatus({ ...BASE, conversionRate: 1.0 });
    expect(r.monthlyOrders).toBe(20);
    expect(r.monthlyRevenue).toBe(6000000);
  });
});

describe("calcRecoveryLine", () => {
  it("4. 単価が高く1件で回収できるケース（単価100万円）", () => {
    const r = calcRecoveryLine({ ...BASE, avgOrderValue: 1000000, grossMarginRate: 0.5 });
    // 必要受注数 = 300000 / (1000000 * 0.5) = 0.6件
    expect(r.requiredAdditionalOrders).toBeCloseTo(0.6);
    // 必要問い合わせ = 0.6 / 0.3 = 2件
    expect(r.requiredAdditionalInquiries).toBeCloseTo(2);
  });

  it("1. 標準ケースの回収ライン", () => {
    const r = calcRecoveryLine(BASE);
    // 必要受注 = 300000 / (300000 * 0.5) = 2件
    expect(r.requiredAdditionalOrders).toBeCloseTo(2);
    // 必要問い合わせ = 2 / 0.3 ≈ 6.67件
    expect(r.requiredAdditionalInquiries).toBeCloseTo(6.67, 1);
    // 増加率 = 6.67 / 20 ≈ 33.3%
    expect(r.requiredInquiryIncreaseRate).toBeCloseTo(0.333, 2);
  });
});

describe("calcScenario", () => {
  const current = calcCurrentStatus(BASE);

  it("6. 改善率0%のケース", () => {
    const r = calcScenario(BASE, 0, current);
    expect(r.improvedInquiries).toBe(20);
    expect(r.revenueIncrease).toBe(0);
    expect(r.grossProfitIncrease).toBe(0);
    expect(r.monthlyPnL).toBeCloseTo(-300000);
  });

  it("7. 改善率50%のケース", () => {
    const r = calcScenario(BASE, 0.5, current);
    expect(r.improvedInquiries).toBe(30);
    expect(r.improvedOrders).toBe(9);
    expect(r.revenueIncrease).toBeCloseTo(900000);
    expect(r.grossProfitIncrease).toBeCloseTo(450000);
    expect(r.monthlyPnL).toBeCloseTo(150000);
  });

  it("5. 初期費用ありのケース", () => {
    const inputs = { ...BASE, initialFee: 300000 };
    const c = calcCurrentStatus(inputs);
    const r = calcScenario(inputs, 0.2, c);
    // 改善後受注: 24 * 0.3 = 7.2件
    // 売上増加: (7.2-6) * 300000 = 360000
    // 粗利増加: 360000 * 0.5 = 180000
    // 月次損益: 180000 - 300000 = -120000
    // 累計: -120000 * 6 - 300000 = -1020000
    expect(r.monthlyPnL).toBeCloseTo(-120000);
    expect(r.cumulativePnL).toBeCloseTo(-1020000);
  });
});

describe("getJudgment", () => {
  it("月次損益 >= 0 なら recommended", () => {
    expect(getJudgment(0, 0.8)).toBe("recommended");
    expect(getJudgment(100, 0.6)).toBe("recommended");
  });

  it("月次損益 < 0 かつ 増加率 < 50% なら cautious", () => {
    expect(getJudgment(-1, 0.3)).toBe("cautious");
    expect(getJudgment(-100, 0.49)).toBe("cautious");
  });

  it("月次損益 < 0 かつ 増加率 >= 50% なら not-recommended", () => {
    expect(getJudgment(-1, 0.5)).toBe("not-recommended");
    expect(getJudgment(-1000, 0.9)).toBe("not-recommended");
  });
});

describe("calcAll - 統合テスト", () => {
  it("9. 初期値ケース（デフォルト値）でエラーなく計算される", () => {
    const r = calcAll(BASE);
    expect(r.current).toBeDefined();
    expect(r.recovery).toBeDefined();
    expect(r.conservative).toBeDefined();
    expect(r.standard).toBeDefined();
    expect(r.aggressive).toBeDefined();
  });

  it("10. 異常値（0やNaN）でもクラッシュしない", () => {
    const inputs = {
      ...BASE,
      monthlyInquiries: 0,
      avgOrderValue: 0,
      grossMarginRate: 0,
      conversionRate: 0,
    };
    expect(() => calcAll(inputs)).not.toThrow();
    const r = calcAll(inputs);
    expect(r.current.monthlyRevenue).toBe(0);
    expect(r.recovery.requiredAdditionalOrders).toBe(0);
  });
});
