import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import type { ThemePerformance } from "@/lib/growth-os/db/metrics";

export interface AnalyticsRecommendation {
  increase_themes: string[];
  decrease_themes: string[];
  productize_themes: string[];
  reasoning: string;
}

const SYSTEM = `あなたはAnalytics Advisor Agentです。テーマ別の成果データ(PV・スキ・売上・購入数)を見て、
「次に増やすべきテーマ」「減らすべきテーマ」「商品化すべきテーマ」をそれぞれ挙げてください。
テーマは 会社依存/AI失業不安/副業/定年/転職/老後/お金/第二キャリア などnote Growth OSで扱う区分に沿うこと。
出力は指定のJSONスキーマのみ。`;

export async function adviseOnAnalytics(themes: ThemePerformance[]): Promise<AnalyticsRecommendation> {
  const table = themes
    .map((t) => `${t.theme_tag}: PV=${t.pv}, スキ=${t.likes}, 売上=${t.sales_amount}円, 購入数=${t.purchase_count}`)
    .join("\n");

  const prompt = `以下のテーマ別成果データを分析してください。

${table || "(データなし)"}

以下のJSONスキーマで出力してください:
{
  "increase_themes": string[],
  "decrease_themes": string[],
  "productize_themes": string[],
  "reasoning": string
}`;

  const result = await callClaudeForJson<AnalyticsRecommendation>({ system: SYSTEM, prompt, maxTokens: 1024 });
  return result.data;
}
