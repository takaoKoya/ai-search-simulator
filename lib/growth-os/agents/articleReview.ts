import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import type { AiReviewVerdict } from "@/lib/growth-os/types";

export interface ArticleReviewResult {
  reader_feedback: string;
  reader_verdict: AiReviewVerdict;
  chief_editor_feedback: string;
  chief_editor_verdict: AiReviewVerdict;
  revision_instructions: string;
}

// 50代読者Agent と 辛口編集長Agent を1コールに統合する(記録上は別agent_typeとして保存)。
const SYSTEM = `あなたは2つの視点でnote記事ドラフトをレビューします。

1. 50代読者Agent: 45〜59歳の会社員として読み、「刺さらない箇所」「自分事に感じられない箇所」「読み進めるのが辛い箇所」を具体的に指摘する
2. 辛口編集長Agent: プロの編集者として、構成の論理性・説得力・冗長さ・タイトルの魅力を厳しく評価する。甘い評価はしない

verdictはPASS(このまま公開して良い)/NEEDS_REVISION(部分修正が必要)/FAIL(構成から見直しが必要)のいずれか。
revision_instructionsには、Writer Agentがそのまま使える具体的な修正指示を箇条書きでまとめること。
出力は指定のJSONスキーマのみ。`;

export async function reviewArticle(input: { title: string; body_markdown: string }): Promise<ArticleReviewResult> {
  const prompt = `以下のnote記事ドラフトをレビューしてください。

# ${input.title}

${input.body_markdown}

以下のJSONスキーマで出力してください:
{
  "reader_feedback": string,
  "reader_verdict": "PASS" | "NEEDS_REVISION" | "FAIL",
  "chief_editor_feedback": string,
  "chief_editor_verdict": "PASS" | "NEEDS_REVISION" | "FAIL",
  "revision_instructions": string
}`;

  const result = await callClaudeForJson<ArticleReviewResult>({ system: SYSTEM, prompt, maxTokens: 2048 });
  return result.data;
}
