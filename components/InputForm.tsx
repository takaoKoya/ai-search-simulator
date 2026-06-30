"use client";

import { useState } from "react";
import { SimulatorInputs } from "@/lib/calc";
import { DEFAULT_INPUTS } from "@/constants/defaults";

interface Props {
  inputs: SimulatorInputs & {
    companyName: string;
    industry: string;
    area: string;
    mainService: string;
    competitor1: string;
    competitor2: string;
    competitor3: string;
  };
  onChange: (key: string, value: string | number) => void;
}

interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "number" | "percent";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  note?: string;
  tooltip: string;
}

function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex items-center ml-1">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[10px] font-bold leading-none flex items-center justify-center hover:bg-blue-100 hover:text-blue-600 transition-colors flex-shrink-0"
        aria-label="説明"
      >
        ?
      </button>
      {open && (
        <span className="absolute left-5 top-1/2 -translate-y-1/2 z-50 w-56 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl leading-relaxed whitespace-normal pointer-events-none">
          {text}
          <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
        </span>
      )}
    </span>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: string | number;
  onChange: (key: string, value: string | number) => void;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (field.type === "text") {
      onChange(field.key, e.target.value);
    } else if (field.type === "percent") {
      const parsed = parseFloat(e.target.value);
      onChange(field.key, isNaN(parsed) ? 0 : parsed / 100);
    } else {
      const parsed = parseFloat(e.target.value);
      onChange(field.key, isNaN(parsed) ? 0 : parsed);
    }
  };

  const displayValue =
    field.type === "percent"
      ? ((value as number) * 100).toFixed(0)
      : value;

  return (
    <div className="mb-4">
      <label className="flex items-center text-sm font-medium text-gray-700 mb-1">
        <span>{field.label}</span>
        {field.unit && (
          <span className="ml-1 text-xs text-gray-400">({field.unit})</span>
        )}
        <Tooltip text={field.tooltip} />
      </label>
      <div className="flex items-center gap-1">
        <input
          type={field.type === "text" ? "text" : "number"}
          value={displayValue}
          onChange={handleChange}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === "number" ? 1 : undefined)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {field.type === "percent" && (
          <span className="text-sm text-gray-500 whitespace-nowrap">%</span>
        )}
      </div>
      {field.note && (
        <p className="mt-1 text-xs text-gray-400">{field.note}</p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3 pb-1 border-b border-blue-100">
        {title}
      </h3>
      {children}
    </div>
  );
}

const COMPANY_FIELDS: FieldConfig[] = [
  {
    key: "companyName",
    label: "会社名",
    type: "text",
    tooltip: "商談相手の会社名。提案コメントの冒頭に自動で反映されます。",
  },
  {
    key: "industry",
    label: "業種",
    type: "text",
    tooltip: "例：建設業、士業、医療、EC など。業種によって粗利率や受注率の相場感が変わります。",
  },
  {
    key: "area",
    label: "商圏",
    type: "text",
    tooltip: "例：関東全域、東京都内、全国 など。AI検索対策の効果範囲の判断に使います。",
  },
  {
    key: "mainService",
    label: "主要サービス",
    type: "text",
    tooltip: "売上の中心となるサービス・商品。単価や粗利率の根拠を確認するために入力します。",
  },
  {
    key: "competitor1",
    label: "競合1",
    type: "text",
    tooltip: "AI検索で上位に表示されている競合他社。対策の優先度を判断する参考にします。",
  },
  {
    key: "competitor2",
    label: "競合2",
    type: "text",
    tooltip: "競合2社目。複数記入することで競合環境の全体像を把握できます。",
  },
  {
    key: "competitor3",
    label: "競合3",
    type: "text",
    tooltip: "競合3社目。空欄でも構いません。",
  },
];

const CURRENT_FIELDS: FieldConfig[] = [
  {
    key: "monthlyInquiries",
    label: "月間問い合わせ数",
    type: "number",
    unit: "件",
    min: 0,
    tooltip: "1ヶ月に届く問い合わせの合計件数。Web・電話・来店など全チャネルの合算が理想ですが、Web経由のみでも可。",
  },
  {
    key: "avgOrderValue",
    label: "平均受注単価",
    type: "number",
    unit: "円",
    min: 0,
    step: 10000,
    tooltip: "1件の受注あたりの平均売上金額。複数商品・サービスがある場合は加重平均を使ってください。",
  },
  {
    key: "grossMarginRate",
    label: "粗利率",
    type: "percent",
    min: 0,
    max: 100,
    tooltip: "売上から原価（仕入れ・外注費など）を引いた粗利の割合。例：売上100万円・原価50万円なら粗利率50%。",
  },
  {
    key: "conversionRate",
    label: "受注率（問い合わせ→受注）",
    type: "percent",
    min: 0,
    max: 100,
    tooltip: "問い合わせが受注に至る割合。例：10件問い合わせて3件受注なら30%。商談力・価格競争力が反映されます。",
  },
  {
    key: "monthlyAdSpend",
    label: "月間広告費",
    type: "number",
    unit: "円",
    min: 0,
    step: 10000,
    tooltip: "現在かけているWeb広告費（リスティング・SNS広告など）の月額合計。AI検索対策との費用対効果比較に使います。",
  },
  {
    key: "webRevenueRatio",
    label: "Web経由売上比率",
    type: "percent",
    min: 0,
    max: 100,
    tooltip: "全売上のうちWebからの問い合わせ・集客が占める割合。低いほどWeb強化の伸びしろが大きいと判断できます。",
  },
];

const INVESTMENT_FIELDS: FieldConfig[] = [
  {
    key: "monthlyFee",
    label: "月額費用",
    type: "number",
    unit: "円",
    min: 0,
    step: 10000,
    note: `初期値: ${DEFAULT_INPUTS.monthlyFee.toLocaleString()}円`,
    tooltip: "AI検索対策サービスの月額料金。回収ラインや損益計算の基準値として使われます。",
  },
  {
    key: "initialFee",
    label: "初期費用",
    type: "number",
    unit: "円",
    min: 0,
    step: 10000,
    tooltip: "契約開始時に発生する初期設定費用。累計損益の計算に一度だけ差し引かれます。0円なら空白でOK。",
  },
  {
    key: "contractMonths",
    label: "契約期間",
    type: "number",
    unit: "ヶ月",
    min: 1,
    max: 60,
    tooltip: "想定する契約期間。累計損益はこの期間で計算されます。一般的には6〜12ヶ月が目安です。",
  },
  {
    key: "improvementRateConservative",
    label: "改善率 保守ライン",
    type: "percent",
    min: 0,
    max: 200,
    tooltip: "最も慎重な見込みの問い合わせ増加率。「最低でもこのくらいは改善できる」という下限値として設定します。",
  },
  {
    key: "improvementRateStandard",
    label: "改善率 標準ライン",
    type: "percent",
    min: 0,
    max: 200,
    tooltip: "平均的な改善を想定したケース。過去の実績や業界平均をもとに設定します。提案の軸となる数値です。",
  },
  {
    key: "improvementRateAggressive",
    label: "改善率 強気ライン",
    type: "percent",
    min: 0,
    max: 200,
    tooltip: "うまくいった場合の楽観的なシナリオ。競合が弱い・コンテンツ改善余地が大きいケースで想定します。",
  },
];

export default function InputForm({ inputs, onChange }: Props) {
  return (
    <div className="space-y-1">
      <Section title="会社情報">
        {COMPANY_FIELDS.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={(inputs as unknown as Record<string, string | number>)[f.key] ?? ""}
            onChange={onChange}
          />
        ))}
      </Section>

      <Section title="現状数値">
        {CURRENT_FIELDS.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={(inputs as unknown as Record<string, string | number>)[f.key] ?? 0}
            onChange={onChange}
          />
        ))}
      </Section>

      <Section title="投資条件">
        {INVESTMENT_FIELDS.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={(inputs as unknown as Record<string, string | number>)[f.key] ?? 0}
            onChange={onChange}
          />
        ))}
      </Section>
    </div>
  );
}
