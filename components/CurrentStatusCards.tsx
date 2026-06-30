"use client";

import { CurrentStatus, SimulatorInputs } from "@/lib/calc";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  current: CurrentStatus;
  inputs: SimulatorInputs;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function CurrentStatusCards({ current, inputs }: Props) {
  return (
    <div>
      <h2 className="text-base font-bold text-gray-800 mb-3">現状サマリー</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          label="月間問い合わせ数"
          value={`${inputs.monthlyInquiries}件`}
        />
        <StatCard
          label="月間受注数"
          value={`約${current.monthlyOrders.toFixed(1)}件`}
          sub={`受注率 ${formatPercent(inputs.conversionRate)}`}
        />
        <StatCard
          label="月間売上"
          value={formatCurrency(current.monthlyRevenue)}
          sub={`単価 ${formatCurrency(inputs.avgOrderValue)}`}
        />
        <StatCard
          label="月間粗利"
          value={formatCurrency(current.monthlyGrossProfit)}
          sub={`粗利率 ${formatPercent(inputs.grossMarginRate)}`}
        />
        <StatCard
          label="月間広告費"
          value={formatCurrency(inputs.monthlyAdSpend)}
        />
        <StatCard
          label="Web経由売上比率"
          value={formatPercent(inputs.webRevenueRatio)}
        />
      </div>
    </div>
  );
}
