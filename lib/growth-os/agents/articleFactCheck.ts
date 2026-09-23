import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import type { AiReviewVerdict } from "@/lib/growth-os/types";

export interface ArticleFactCheckResult {
  verdict: AiReviewVerdict;
  issues: string[];
  feedback: string;
}

const SYSTEM = `あなたはFact Check Agentです。note記事ドラフトの中から、事実誤認・根拠不明な断定・誇張表現・
古い情報に基づく主張を洗い出してください。数字や制度(年金・退職金・税制など)への言及は特に厳しく確認すること。
問題が1つでもある場合はverdictをNEEDS_REVISIONまたはFAILにし、issuesに具体的な箇所と理由を列挙してください。
他のAgentがどれだけ高評価でも、事実面の問題は見逃さないこと。
出力は指定のJSONスキーマのみ。`;

export async function factCheckArticle(input: { body_markdown: string }): Promise<ArticleFactCheckResult> {
  const prompt = `以下のnote記事ドラフトをファクトチェックしてください。

${input.body_markdown}

以下のJSONスキーマで出力してください:
{
  "verdict": "PASS" | "NEEDS_REVISION" | "FAIL",
  "issues": string[],
  "feedback": string
}`;

  const result = await callClaudeForJson<ArticleFactCheckResult>({ system: SYSTEM, prompt, maxTokens: 1536, temperature: 0.1 });
  return result.data;
}
