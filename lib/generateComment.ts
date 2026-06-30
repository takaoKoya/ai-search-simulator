import { SimulatorInputs, SimulatorResults } from "./calc";
import { formatCurrency, formatPercent, formatCount } from "./format";

const JUDGMENT_LABELS = {
  recommended: "回収可能",
  cautious: "要検討",
  "not-recommended": "非推奨",
} as const;

export function generateProposalComment(
  inputs: SimulatorInputs,
  results: SimulatorResults,
  companyName: string
): string {
  const { current, recovery, standard } = results;
  const stdJudgment = JUDGMENT_LABELS[standard.judgment];

  const lines = [
    companyName
      ? `${companyName}様への提案試算です。`
      : "貴社への提案試算です。",
    "",
    `今回の試算では、平均受注単価${formatCurrency(inputs.avgOrderValue)}、粗利率${formatPercent(inputs.grossMarginRate)}、月間問い合わせ数${inputs.monthlyInquiries}件を前提に計算しています。`,
    "",
    `【現状】`,
    `月間受注数：約${current.monthlyOrders.toFixed(1)}件`,
    `月間売上：${formatCurrency(current.monthlyRevenue)}`,
    `月間粗利：${formatCurrency(current.monthlyGrossProfit)}`,
    "",
    `【投資回収ライン】`,
    `月額${formatCurrency(inputs.monthlyFee)}を回収するには、追加受注${formatCount(recovery.requiredAdditionalOrders)}、追加問い合わせ${formatCount(recovery.requiredAdditionalInquiries)}（問い合わせ増加率${formatPercent(recovery.requiredInquiryIncreaseRate)}）が必要です。`,
    "",
    `【標準ラインでの試算（問い合わせ${formatPercent(inputs.improvementRateStandard)}増）】`,
    `改善後問い合わせ数：約${standard.improvedInquiries.toFixed(1)}件`,
    `売上増加額：${formatCurrency(standard.revenueIncrease)}`,
    `粗利増加額：${formatCurrency(standard.grossProfitIncrease)}`,
    `月次損益：${formatCurrency(standard.monthlyPnL)}`,
    `${inputs.contractMonths}ヶ月累計損益：${formatCurrency(standard.cumulativePnL)}`,
    "",
    `【判定】`,
    `標準ラインでは「${stdJudgment}」と判断されます。`,
    "",
    `※本試算は成果保証ではなく、投資判断のためのシミュレーションです。`,
  ];

  return lines.join("\n");
}
