import { callClaudeForJson } from "@/lib/growth-os/claude/client";

export interface ProductSuggestion {
  product_name: string;
  recommended_price: number;
  target: string;
  problem: string;
  solution: string;
  product_score: number;
  outline: string[];
}

const SYSTEM = `あなたはProduct Suggester Agentです。反応の良かった無料note記事を元に、
有料note・ワークブック・診断・テンプレート・プロンプト集・教材のいずれかの商品候補を1つ提案してください。
45〜59歳の会社員が「今日から一歩踏み出せる」ことを重視し、価格は3,000〜30,000円程度の範囲で現実的に設定してください。
product_scoreは0〜100で「この商品が売れる確度」を表します。
outlineは商品の構成案を5〜8項目の配列で。
出力は指定のJSONスキーマのみ。`;

export async function suggestProduct(input: {
  title: string;
  body_markdown: string;
  pv: number;
  likes: number;
}): Promise<ProductSuggestion> {
  const prompt = `以下の無料note記事(PV: ${input.pv}, スキ: ${input.likes})から商品化を検討してください。

# ${input.title}

${input.body_markdown}

以下のJSONスキーマで出力してください:
{
  "product_name": string,
  "recommended_price": number,
  "target": string,
  "problem": string,
  "solution": string,
  "product_score": number (0-100),
  "outline": string[]
}`;

  const result = await callClaudeForJson<ProductSuggestion>({ system: SYSTEM, prompt, maxTokens: 1536 });
  return result.data;
}
