import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import type { AiReviewVerdict, NoteArticleType } from "@/lib/growth-os/types";

export interface ArticleSalesEditResult {
  quality_score: number;
  verdict: AiReviewVerdict;
  feedback: string;
  suggested_title: string | null;
}

const SYSTEM = `あなたはSales Editor Agentです。note記事ドラフトの最終評価を行い、
タイトルの魅力・冒頭の掴み・CTA(有料記事なら購入導線、無料記事なら次のアクション導線)を基準に
0〜100点のquality_scoreを付けてください。80点が公開ラインの目安です。
verdictはPASS(80点以上、または軽微な修正のみで公開可)/NEEDS_REVISION(80点未満で書き直しが必要)のいずれか。
出力は指定のJSONスキーマのみ。`;

export async function salesEditArticle(input: {
  title: string;
  body_markdown: string;
  articleType: NoteArticleType;
  price: number | null;
}): Promise<ArticleSalesEditResult> {
  const prompt = `# ${input.title}
種別: ${input.articleType === "PAID" ? `有料note(${input.price ?? "未設定"}円)` : "無料note"}

${input.body_markdown}

以下のJSONスキーマで出力してください:
{
  "quality_score": number (0-100),
  "verdict": "PASS" | "NEEDS_REVISION",
  "feedback": string,
  "suggested_title": string | null
}`;

  const result = await callClaudeForJson<ArticleSalesEditResult>({ system: SYSTEM, prompt, maxTokens: 1024 });
  return result.data;
}
