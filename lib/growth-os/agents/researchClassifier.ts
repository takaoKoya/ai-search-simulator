import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import type { HarmType } from "@/lib/growth-os/types";

export interface ResearchClassificationResult {
  harm_type: HarmType[];
  trend_score: number;
  pain_score: number;
  reasoning: string;
}

const SYSTEM = `あなたは「50代note Growth OS」のResearch Classifier Agentです。
45〜59歳の会社員読者を対象に、市場調査メモをHARM分類(Health/Ambition/Relation/Money)へ分類します。
「会社に依存しているのが怖い」のような悩みは複数区分に跨ることが多いため、該当するもの全てを配列で返してください(単一に絞り込みすぎない)。
trend_score(話題性)とpain_score(悩みの深刻さ)は0〜100の整数で、それぞれの理由も簡潔に述べてください。
出力は指定のJSONスキーマのみ。前後に説明文を付けないこと。`;

export async function classifyResearchItem(input: {
  title: string;
  summary: string | null;
  source: string;
  keyword: string | null;
  target_age: string | null;
}): Promise<ResearchClassificationResult> {
  const prompt = `以下の市場調査メモを分類してください。

出典: ${input.source}
検索語: ${input.keyword ?? "(なし)"}
想定読者年齢: ${input.target_age ?? "45〜59歳の会社員"}
タイトル: ${input.title}
要約: ${input.summary ?? "(なし)"}

以下のJSONスキーマで出力してください:
{
  "harm_type": ["Health" | "Ambition" | "Relation" | "Money", ...],
  "trend_score": number (0-100),
  "pain_score": number (0-100),
  "reasoning": string
}`;

  const result = await callClaudeForJson<ResearchClassificationResult>({ system: SYSTEM, prompt, maxTokens: 1024 });
  return result.data;
}
