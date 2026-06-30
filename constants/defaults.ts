export const DEFAULT_INPUTS = {
  companyName: "",
  industry: "",
  area: "",
  mainService: "",
  competitor1: "",
  competitor2: "",
  competitor3: "",
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
} as const;

export const IMPROVEMENT_THRESHOLDS = {
  recommended: 0,
  cautious: 0.5,
} as const;

export const CHART_MONTHS = [3, 6, 12] as const;
