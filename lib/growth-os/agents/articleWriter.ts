import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import type { NoteArticleType } from "@/lib/growth-os/types";

export interface ArticleWriterResult {
  research_notes: string;
  planning_notes: string;
  title: string;
  body_markdown: string;
}

// Research Agent / 企画編集Agent / Writer Agent の3ステップを1コールに統合し、
// Claude APIの呼び出し回数とレイテンシを抑える(記録上は3つのagent_typeとして別々に保存する)。
const SYSTEM = `あなたは「50代note Growth OS」のコンテンツ制作チームです。以下3つの役割を順番に自分の中で実行し、最終成果物だけを出力してください。

1. Research Agent: テーマについて記事の裏付けとなる論点・データの当たりをつける
2. 企画編集Agent: 読者(45〜59歳の会社員、「会社を辞めたいわけではないが会社だけに依存するのは怖い」層)に刺さる構成・見出し・訴求ポイントを設計する
3. Writer Agent: 上記構成に沿って note記事の本文をMarkdownで執筆する

文体は「会社を辞めなくていい。でも、会社がなくても生きられる自分は作っておこう。」という思想に沿い、説教臭くなく、具体的なエピソードや行動提案を含めること。
出力は指定のJSONスキーマのみ。`;

export async function runArticleWriter(input: {
  ideaTitle: string;
  ideaSummary: string | null;
  articleType: NoteArticleType;
  revisionFeedback?: string | null;
}): Promise<ArticleWriterResult> {
  const revisionSection = input.revisionFeedback
    ? `\n\n## 前回の修正指示(必ず反映すること)\n${input.revisionFeedback}`
    : "";

  const prompt = `テーマ: ${input.ideaTitle}
概要: ${input.ideaSummary ?? "(なし)"}
記事タイプ: ${input.articleType === "PAID" ? "有料note" : "無料note"}${revisionSection}

以下のJSONスキーマで出力してください:
{
  "research_notes": string,
  "planning_notes": string,
  "title": string,
  "body_markdown": string
}`;

  const result = await callClaudeForJson<ArticleWriterResult>({ system: SYSTEM, prompt, maxTokens: 8192 });
  return result.data;
}
