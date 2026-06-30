"use client";

import { RecoveryLine, SimulatorInputs } from "@/lib/calc";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  recovery: RecoveryLine;
  inputs: SimulatorInputs;
}

export default function RecoveryLineSection({ recovery, inputs }: Props) {
  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="pt-5 pb-5">
        <h2 className="text-base font-bold text-blue-800 mb-3">
          投資回収ライン
        </h2>
        <p className="text-sm text-blue-700 mb-4">
          月額{formatCurrency(inputs.monthlyFee)}を回収するには
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-3xl font-extrabold text-blue-900">
              約{Math.ceil(recovery.requiredAdditionalOrders)}件
            </p>
            <p className="text-xs text-blue-700 mt-1">追加受注</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-extrabold text-blue-900">
              約{Math.ceil(recovery.requiredAdditionalInquiries)}件
            </p>
            <p className="text-xs text-blue-700 mt-1">追加問い合わせ</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-extrabold text-blue-900">
              {formatPercent(recovery.requiredInquiryIncreaseRate)}
            </p>
            <p className="text-xs text-blue-700 mt-1">問い合わせ増加率</p>
          </div>
        </div>
        <p className="text-xs text-blue-600 mt-4 text-center">
          が必要です。
        </p>
      </CardContent>
    </Card>
  );
}
