import { callClaudeForJson } from "@/lib/growth-os/claude/client";
import { THREADS_PATTERN_LABELS, type ThreadsPatternType, type ThreadsToneScores } from "@/lib/growth-os/types";

export interface ThreadsPatternDraft {
  pattern_type: ThreadsPatternType;
  body: string;
}

const PATTERN_LIST = (Object.keys(THREADS_PATTERN_LABELS) as ThreadsPatternType[])
  .map((key) => `- ${key} (${THREADS_PATTERN_LABELS[key]})`)
  .join("\n");

const GENERATOR_SYSTEM = `あなたは「50代note Growth OS」のThreads Generator Agentです。
「会社を辞めなくていい。でも、会社がなくても生きられる自分は作っておこう。」という思想を持つ、
45〜59歳の会社員向けThreads投稿を1テーマから5パターン作成します。

${PATTERN_LIST}

各投稿は日本語で200〜400文字、絵文字は使わず、押し付けがましい売り込み口調を避けてください。
出力は指定のJSONスキーマのみ。`;

export async function generateThreadsPatterns(input: {
  title: string;
  summary: string | null;
}): Promise<ThreadsPatternDraft[]> {
  const prompt = `以下のテーマでThreads投稿を5パターン作成してください。

タイトル: ${input.title}
概要: ${input.summary ?? "(なし)"}

以下のJSONスキーマで出力してください:
{
  "patterns": [
    { "pattern_type": "EMPATHY", "body": string },
    { "pattern_type": "PROBLEM", "body": string },
    { "pattern_type": "FAILURE", "body": string },
    { "pattern_type": "QUESTION", "body": string },
    { "pattern_type": "CONTRARIAN", "body": string }
  ]
}`;

  const result = await callClaudeForJson<{ patterns: ThreadsPatternDraft[] }>({
    system: GENERATOR_SYSTEM,
    prompt,
    maxTokens: 2048,
  });

  return result.data.patterns;
}

const TONE_SYSTEM = `あなたは「50代note Growth OS」のThreads Tone Analyzer Agentです。
投稿本文を読み、以下6軸をそれぞれ0〜100で評価してください(高いほどその傾向が強い、humanityとempathyのみ高いほど良い)。
- ai_smell: AIが書いたような不自然さ
- sales_smell: 売り込み臭
- preachy: 説教臭
- hype: 過剰な煽り
- humanity: 人間味(高いほど良い)
- empathy: 共感性(高いほど良い)
出力は指定のJSONスキーマのみ。`;

export async function analyzeThreadsTone(body: string): Promise<ThreadsToneScores> {
  const prompt = `以下のThreads投稿本文を評価してください。

---
${body}
---

以下のJSONスキーマで出力してください:
{ "ai_smell": number, "sales_smell": number, "preachy": number, "hype": number, "humanity": number, "empathy": number }`;

  const result = await callClaudeForJson<ThreadsToneScores>({ system: TONE_SYSTEM, prompt, maxTokens: 512 });
  return result.data;
}
