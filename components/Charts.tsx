"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { SimulatorInputs, SimulatorResults, calcCumulativePnLByMonth } from "@/lib/calc";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_MONTHS } from "@/constants/defaults";

interface Props {
  results: SimulatorResults;
  inputs: SimulatorInputs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const currencyFormatter = (value: any) =>
  typeof value === "number" ? formatCurrency(value) : String(value ?? "");

type InsightLevel = "good" | "warning" | "bad";

interface Insight {
  level: InsightLevel;
  text: string;
}

const LEVEL_STYLE: Record<InsightLevel, string> = {
  good: "bg-green-50 border-green-200 text-green-800",
  warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
  bad: "bg-red-50 border-red-200 text-red-800",
};

const LEVEL_ICON: Record<InsightLevel, string> = {
  good: "✅",
  warning: "⚠️",
  bad: "❌",
};

function InsightBox({ insight }: { insight: Insight }) {
  return (
    <div className={`mt-3 px-3 py-2 rounded-lg border text-xs leading-relaxed ${LEVEL_STYLE[insight.level]}`}>
      <span className="mr-1">{LEVEL_ICON[insight.level]}</span>
      {insight.text}
    </div>
  );
}

function buildRevenueInsight(results: SimulatorResults, inputs: SimulatorInputs): Insight {
  const stdRevenueIncrease = results.standard.revenueIncrease;
  const stdGrossIncrease = results.standard.grossProfitIncrease;
  const ratio = stdGrossIncrease / inputs.monthlyFee;

  if (ratio >= 1) {
    return {
      level: "good",
      text: `標準ラインで売上が${formatCurrency(stdRevenueIncrease)}増加し、粗利増加額（${formatCurrency(stdGrossIncrease)}）が月額費用を上回ります。売上規模が投資に見合っています。`,
    };
  } else if (ratio >= 0.5) {
    return {
      level: "warning",
      text: `標準ラインで売上は${formatCurrency(stdRevenueIncrease)}増えますが、粗利増加額（${formatCurrency(stdGrossIncrease)}）は月額費用（${formatCurrency(inputs.monthlyFee)}）をまだ下回ります。受注率か単価の改善も合わせて検討が必要です。`,
    };
  } else {
    return {
      level: "bad",
      text: `標準ラインでの粗利増加額（${formatCurrency(stdGrossIncrease)}）が月額費用（${formatCurrency(inputs.monthlyFee)}）の半分にも届きません。現状の単価・粗利率では費用対効果が出にくい構造です。`,
    };
  }
}

function buildProfitInsight(results: SimulatorResults, inputs: SimulatorInputs): Insight {
  const { conservative, standard, aggressive } = results;
  const profitableCount = [conservative, standard, aggressive].filter(
    (s) => s.grossProfitIncrease >= inputs.monthlyFee
  ).length;

  if (profitableCount === 3) {
    return {
      level: "good",
      text: `保守・標準・強気のすべてのラインで粗利増加額が月額費用を超えています。どのシナリオでも黒字化が見込めます。`,
    };
  } else if (profitableCount >= 1) {
    const labels = ["保守", "標準", "強気"];
    const profitable = [conservative, standard, aggressive]
      .map((s, i) => (s.grossProfitIncrease >= inputs.monthlyFee ? labels[i] : null))
      .filter(Boolean)
      .join("・");
    return {
      level: "warning",
      text: `${profitable}ラインで粗利増加額が月額費用を超えます。緑の棒が赤を上回るシナリオが実現できれば回収できます。`,
    };
  } else {
    return {
      level: "bad",
      text: `どのラインでも粗利増加額が月額費用に届いていません。問い合わせが増えても、現状の単価・粗利率では費用回収が難しい状態です。単価アップや粗利率改善を先行させることを検討してください。`,
    };
  }
}

function buildCumulativeInsight(
  results: SimulatorResults,
  inputs: SimulatorInputs,
  cumulativeData: { name: string; 保守: number; 標準: number; 強気: number }[]
): Insight {
  const lastStd = cumulativeData[cumulativeData.length - 1]["標準"];
  const lastCons = cumulativeData[cumulativeData.length - 1]["保守"];
  const period = inputs.contractMonths;

  if (lastStd > 0 && lastCons > 0) {
    return {
      level: "good",
      text: `保守ラインでも${period}ヶ月後には累計黒字（${formatCurrency(lastCons)}）になる見通しです。契約期間内での回収が現実的です。`,
    };
  } else if (lastStd > 0) {
    return {
      level: "warning",
      text: `標準ラインでは${period}ヶ月後に累計${formatCurrency(lastStd)}の黒字ですが、保守ラインはまだ赤字です。改善が標準以上で推移するかどうかが鍵になります。`,
    };
  } else {
    return {
      level: "bad",
      text: `標準ラインでも${period}ヶ月後の累計は${formatCurrency(lastStd)}で赤字です。契約期間中の回収は難しい試算になっています。期間延長や改善率の見直しを検討してください。`,
    };
  }
}

function buildMonthlyInsight(results: SimulatorResults, inputs: SimulatorInputs): Insight {
  const { standard, conservative } = results;

  if (standard.monthlyPnL > 0) {
    return {
      level: "good",
      text: `標準ラインでは月次損益が${formatCurrency(standard.monthlyPnL)}の黒字です。毎月この額が積み上がっていきます。`,
    };
  } else if (conservative.monthlyPnL > standard.monthlyPnL * 0.5) {
    return {
      level: "warning",
      text: `標準ラインでも月次損益は${formatCurrency(standard.monthlyPnL)}の赤字ですが、損失幅は限定的です。強気ラインが実現すれば月次黒字（${formatCurrency(results.aggressive.monthlyPnL)}）に転換します。`,
    };
  } else {
    return {
      level: "bad",
      text: `どのラインでも月次損益は赤字です。現状の数値では投資回収が厳しい構造です。問い合わせ増加だけでなく、受注率や単価の改善も同時に進める必要があります。`,
    };
  }
}

export default function Charts({ results, inputs }: Props) {
  const { current, conservative, standard, aggressive } = results;

  const revenueData = [
    { name: "現状", 売上: current.monthlyRevenue, 粗利: current.monthlyGrossProfit },
    {
      name: "保守",
      売上: current.monthlyRevenue + conservative.revenueIncrease,
      粗利: current.monthlyGrossProfit + conservative.grossProfitIncrease,
    },
    {
      name: "標準",
      売上: current.monthlyRevenue + standard.revenueIncrease,
      粗利: current.monthlyGrossProfit + standard.grossProfitIncrease,
    },
    {
      name: "強気",
      売上: current.monthlyRevenue + aggressive.revenueIncrease,
      粗利: current.monthlyGrossProfit + aggressive.grossProfitIncrease,
    },
  ];

  const profitData = [
    { name: "保守", 粗利増加額: conservative.grossProfitIncrease, 月額費用: inputs.monthlyFee },
    { name: "標準", 粗利増加額: standard.grossProfitIncrease, 月額費用: inputs.monthlyFee },
    { name: "強気", 粗利増加額: aggressive.grossProfitIncrease, 月額費用: inputs.monthlyFee },
  ];

  const months = [...CHART_MONTHS];
  const cumulativeData = months.map((month) => ({
    name: `${month}ヶ月`,
    保守: calcCumulativePnLByMonth(inputs, inputs.improvementRateConservative, [month], current)[0].value,
    標準: calcCumulativePnLByMonth(inputs, inputs.improvementRateStandard, [month], current)[0].value,
    強気: calcCumulativePnLByMonth(inputs, inputs.improvementRateAggressive, [month], current)[0].value,
  }));

  const scenarioData = [
    { name: "保守", 月次損益: conservative.monthlyPnL },
    { name: "標準", 月次損益: standard.monthlyPnL },
    { name: "強気", 月次損益: aggressive.monthlyPnL },
  ];

  const revenueInsight = buildRevenueInsight(results, inputs);
  const profitInsight = buildProfitInsight(results, inputs);
  const cumulativeInsight = buildCumulativeInsight(results, inputs, cumulativeData);
  const monthlyInsight = buildMonthlyInsight(results, inputs);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-bold text-gray-800">グラフ</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chart 1 */}
        <Card>
          <CardHeader>
            <CardTitle>改善後の売上・粗利はどう変わる？</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenueData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={currencyFormatter} tick={{ fontSize: 10 }} width={80} />
                <Tooltip formatter={currencyFormatter} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="売上" fill="#93C5FD" radius={[4, 4, 0, 0]} />
                <Bar dataKey="粗利" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <InsightBox insight={revenueInsight} />
          </CardContent>
        </Card>

        {/* Chart 2 */}
        <Card>
          <CardHeader>
            <CardTitle>投資費用を粗利で回収できる？</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={profitData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={currencyFormatter} tick={{ fontSize: 10 }} width={80} />
                <Tooltip formatter={currencyFormatter} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="粗利増加額" fill="#16A34A" radius={[4, 4, 0, 0]} />
                <Bar dataKey="月額費用" fill="#F87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <InsightBox insight={profitInsight} />
          </CardContent>
        </Card>

        {/* Chart 3 */}
        <Card>
          <CardHeader>
            <CardTitle>契約期間中、トータルで黒字になる？</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={cumulativeData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={currencyFormatter} tick={{ fontSize: 10 }} width={80} />
                <Tooltip formatter={currencyFormatter} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="4 2" label={{ value: "損益分岐", position: "right", fontSize: 10 }} />
                <Line type="monotone" dataKey="保守" stroke="#F59E0B" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="標準" stroke="#2563EB" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="強気" stroke="#16A34A" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
            <InsightBox insight={cumulativeInsight} />
          </CardContent>
        </Card>

        {/* Chart 4 */}
        <Card>
          <CardHeader>
            <CardTitle>毎月いくらプラス／マイナスになる？</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={scenarioData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={currencyFormatter} tick={{ fontSize: 10 }} width={80} />
                <Tooltip formatter={currencyFormatter} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="4 2" label={{ value: "損益分岐", position: "right", fontSize: 10 }} />
                <Bar
                  dataKey="月次損益"
                  radius={[4, 4, 0, 0]}
                  fill="#2563EB"
                />
              </BarChart>
            </ResponsiveContainer>
            <InsightBox insight={monthlyInsight} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
