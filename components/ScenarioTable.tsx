"use client";

import { ScenarioResult, SimulatorInputs } from "@/lib/calc";
import { formatCurrency, formatPercent } from "@/lib/format";

interface Props {
  conservative: ScenarioResult;
  standard: ScenarioResult;
  aggressive: ScenarioResult;
  inputs: SimulatorInputs;
}

const JUDGMENT_CONFIG = {
  recommended: {
    label: "回収可能",
    bg: "bg-green-100",
    text: "text-green-800",
    border: "border-green-300",
    dot: "bg-green-500",
  },
  cautious: {
    label: "要検討",
    bg: "bg-yellow-100",
    text: "text-yellow-800",
    border: "border-yellow-300",
    dot: "bg-yellow-500",
  },
  "not-recommended": {
    label: "非推奨",
    bg: "bg-red-100",
    text: "text-red-800",
    border: "border-red-300",
    dot: "bg-red-500",
  },
} as const;

const JUDGMENT_DESCRIPTION = {
  recommended: "投資回収ラインを超えています",
  cautious: "短期回収は未達ですが、改善余地があります",
  "not-recommended":
    "現状条件ではおすすめしません。単価改善・CVR改善・広告改善を優先すべきです。",
} as const;

function JudgmentBadge({ judgment }: { judgment: ScenarioResult["judgment"] }) {
  const cfg = JUDGMENT_CONFIG[judgment];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

interface ColProps {
  scenario: ScenarioResult;
  label: string;
  inputs: SimulatorInputs;
  highlight?: boolean;
}

function ScenarioColumn({ scenario, label, inputs, highlight }: ColProps) {
  const cfg = JUDGMENT_CONFIG[scenario.judgment];
  return (
    <td
      className={`px-4 py-3 text-center align-top ${highlight ? "bg-blue-50" : ""}`}
    >
      <div className="space-y-2.5">
        <div>
          <p className="text-xs text-gray-500">問い合わせ増加率</p>
          <p className="font-semibold text-gray-900">
            {formatPercent(scenario.improvementRate)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">改善後問い合わせ数</p>
          <p className="font-semibold">約{scenario.improvedInquiries.toFixed(1)}件</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">改善後受注数</p>
          <p className="font-semibold">約{scenario.improvedOrders.toFixed(1)}件</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">売上増加額</p>
          <p className="font-semibold">{formatCurrency(scenario.revenueIncrease)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">粗利増加額</p>
          <p className="font-semibold text-blue-700">
            {formatCurrency(scenario.grossProfitIncrease)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">月額費用</p>
          <p className="font-semibold text-gray-700">
            {formatCurrency(inputs.monthlyFee)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">月次損益</p>
          <p
            className={`font-bold text-lg ${
              scenario.monthlyPnL >= 0 ? "text-green-700" : "text-red-600"
            }`}
          >
            {formatCurrency(scenario.monthlyPnL)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">
            {inputs.contractMonths}ヶ月累計損益
          </p>
          <p
            className={`font-bold ${
              scenario.cumulativePnL >= 0 ? "text-green-700" : "text-red-600"
            }`}
          >
            {formatCurrency(scenario.cumulativePnL)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">回収判定</p>
          <JudgmentBadge judgment={scenario.judgment} />
          <p className={`text-xs mt-1 ${cfg.text}`}>
            {JUDGMENT_DESCRIPTION[scenario.judgment]}
          </p>
        </div>
      </div>
    </td>
  );
}

export default function ScenarioTable({
  conservative,
  standard,
  aggressive,
  inputs,
}: Props) {
  return (
    <div>
      <h2 className="text-base font-bold text-gray-800 mb-3">3パターン比較</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-4 py-3 text-center font-semibold text-gray-600 bg-gray-50">
                保守ライン
              </th>
              <th className="px-4 py-3 text-center font-semibold text-blue-700 bg-blue-50">
                標準ライン
              </th>
              <th className="px-4 py-3 text-center font-semibold text-gray-600 bg-gray-50">
                強気ライン
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <ScenarioColumn
                scenario={conservative}
                label="保守ライン"
                inputs={inputs}
              />
              <ScenarioColumn
                scenario={standard}
                label="標準ライン"
                inputs={inputs}
                highlight
              />
              <ScenarioColumn
                scenario={aggressive}
                label="強気ライン"
                inputs={inputs}
              />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
