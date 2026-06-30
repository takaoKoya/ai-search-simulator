import { IMPROVEMENT_THRESHOLDS } from "@/constants/defaults";

export interface SimulatorInputs {
  monthlyInquiries: number;
  avgOrderValue: number;
  grossMarginRate: number;
  conversionRate: number;
  monthlyAdSpend: number;
  webRevenueRatio: number;
  monthlyFee: number;
  initialFee: number;
  contractMonths: number;
  improvementRateConservative: number;
  improvementRateStandard: number;
  improvementRateAggressive: number;
}

export interface CurrentStatus {
  monthlyOrders: number;
  monthlyRevenue: number;
  monthlyGrossProfit: number;
}

export interface RecoveryLine {
  requiredAdditionalOrders: number;
  requiredAdditionalInquiries: number;
  requiredInquiryIncreaseRate: number;
}

export type JudgmentResult = "recommended" | "cautious" | "not-recommended";

export interface ScenarioResult {
  improvementRate: number;
  improvedInquiries: number;
  improvedOrders: number;
  revenueIncrease: number;
  grossProfitIncrease: number;
  monthlyPnL: number;
  cumulativePnL: number;
  judgment: JudgmentResult;
}

export interface SimulatorResults {
  current: CurrentStatus;
  recovery: RecoveryLine;
  conservative: ScenarioResult;
  standard: ScenarioResult;
  aggressive: ScenarioResult;
}

export function calcCurrentStatus(inputs: SimulatorInputs): CurrentStatus {
  const monthlyOrders = inputs.monthlyInquiries * inputs.conversionRate;
  const monthlyRevenue = monthlyOrders * inputs.avgOrderValue;
  const monthlyGrossProfit = monthlyRevenue * inputs.grossMarginRate;
  return { monthlyOrders, monthlyRevenue, monthlyGrossProfit };
}

export function calcRecoveryLine(inputs: SimulatorInputs): RecoveryLine {
  const grossProfitPerOrder = inputs.avgOrderValue * inputs.grossMarginRate;
  const requiredAdditionalOrders =
    grossProfitPerOrder > 0 ? inputs.monthlyFee / grossProfitPerOrder : 0;
  const requiredAdditionalInquiries =
    inputs.conversionRate > 0
      ? requiredAdditionalOrders / inputs.conversionRate
      : 0;
  const requiredInquiryIncreaseRate =
    inputs.monthlyInquiries > 0
      ? requiredAdditionalInquiries / inputs.monthlyInquiries
      : 0;
  return {
    requiredAdditionalOrders,
    requiredAdditionalInquiries,
    requiredInquiryIncreaseRate,
  };
}

export function calcScenario(
  inputs: SimulatorInputs,
  improvementRate: number,
  current: CurrentStatus
): ScenarioResult {
  const improvedInquiries =
    inputs.monthlyInquiries * (1 + improvementRate);
  const improvedOrders = improvedInquiries * inputs.conversionRate;
  const improvedRevenue = improvedOrders * inputs.avgOrderValue;
  const improvedGrossProfit = improvedRevenue * inputs.grossMarginRate;

  const revenueIncrease = improvedRevenue - current.monthlyRevenue;
  const grossProfitIncrease = improvedGrossProfit - current.monthlyGrossProfit;
  const monthlyPnL = grossProfitIncrease - inputs.monthlyFee;
  const cumulativePnL =
    monthlyPnL * inputs.contractMonths - inputs.initialFee;

  const { requiredInquiryIncreaseRate } = calcRecoveryLine(inputs);
  const judgment = getJudgment(monthlyPnL, requiredInquiryIncreaseRate);

  return {
    improvementRate,
    improvedInquiries,
    improvedOrders,
    revenueIncrease,
    grossProfitIncrease,
    monthlyPnL,
    cumulativePnL,
    judgment,
  };
}

export function getJudgment(
  monthlyPnL: number,
  requiredInquiryIncreaseRate: number
): JudgmentResult {
  if (monthlyPnL >= IMPROVEMENT_THRESHOLDS.recommended) return "recommended";
  if (requiredInquiryIncreaseRate < IMPROVEMENT_THRESHOLDS.cautious)
    return "cautious";
  return "not-recommended";
}

export function calcAll(inputs: SimulatorInputs): SimulatorResults {
  const current = calcCurrentStatus(inputs);
  const recovery = calcRecoveryLine(inputs);
  const conservative = calcScenario(
    inputs,
    inputs.improvementRateConservative,
    current
  );
  const standard = calcScenario(
    inputs,
    inputs.improvementRateStandard,
    current
  );
  const aggressive = calcScenario(
    inputs,
    inputs.improvementRateAggressive,
    current
  );
  return { current, recovery, conservative, standard, aggressive };
}

export function calcCumulativePnLByMonth(
  inputs: SimulatorInputs,
  improvementRate: number,
  months: number[],
  current: CurrentStatus
): { month: number; value: number }[] {
  const improvedInquiries = inputs.monthlyInquiries * (1 + improvementRate);
  const improvedOrders = improvedInquiries * inputs.conversionRate;
  const improvedRevenue = improvedOrders * inputs.avgOrderValue;
  const improvedGrossProfit = improvedRevenue * inputs.grossMarginRate;
  const grossProfitIncrease =
    improvedGrossProfit - current.monthlyGrossProfit;
  const monthlyPnL = grossProfitIncrease - inputs.monthlyFee;

  return months.map((month) => ({
    month,
    value: monthlyPnL * month - inputs.initialFee,
  }));
}
