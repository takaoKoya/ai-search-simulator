import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ZodSchema } from "zod";
import { estimateCostUsd } from "@/lib/growth-os/claude/pricing";

// サーバー専用。ANTHROPIC_API_KEYはNEXT_PUBLIC_を付けず、クライアントバンドルに
// 絶対に含めないこと(このファイルは "server-only" importでビルド時にも保証する)。
const DEFAULT_MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;

function getClient() {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
  }
  client = new Anthropic({ apiKey });
  return client;
}

export interface ClaudeJsonResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
  raw_text: string;
}

/** レスポンスがMarkdownのコードフェンスで囲まれていても剥がしてJSONとして解釈する。 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

/**
 * AgentプロンプトをClaudeに投げ、JSONとして構造化された結果を受け取る共通ヘルパー。
 * 各Agentの評価が安定する(採点結果がぶれない)よう temperature は低めに固定する。
 */
export async function callClaudeForJson<T>(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<ClaudeJsonResult<T>> {
  const anthropic = getClient();
  const model = params.model ?? process.env.GROWTH_OS_CLAUDE_MODEL ?? DEFAULT_MODEL;

  const response = await anthropic.messages.create({
    model,
    max_tokens: params.maxTokens ?? 4096,
    temperature: params.temperature ?? 0.3,
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : "";

  let data: T;
  try {
    data = extractJson(text) as T;
  } catch {
    throw new Error(`Claudeの応答をJSONとして解釈できませんでした: ${text.slice(0, 500)}`);
  }

  return {
    data,
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    raw_text: text,
  };
}

export interface ClaudeStructuredResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  estimated_cost: number;
  raw_text: string;
  attempts: number;
}

/**
 * Zodスキーマで検証した構造化出力を取得する。JSON破損/スキーマ不一致の場合、
 * エラー内容をフィードバックして再生成させるが、無限retryは行わない
 * (デフォルト maxRetries=2 → 最大3回試行して失敗したら例外を投げる)。
 * AI Provider層(lib/growth-os/ai/*)はこの関数経由でのみClaudeを呼び出す。
 */
export async function callClaudeStructured<T>(params: {
  system: string;
  prompt: string;
  schema: ZodSchema<T>;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  maxRetries?: number;
}): Promise<ClaudeStructuredResult<T>> {
  const anthropic = getClient();
  const model = params.model ?? process.env.GROWTH_OS_CLAUDE_MODEL ?? DEFAULT_MODEL;
  const maxRetries = params.maxRetries ?? 2;

  let prompt = params.prompt;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastText = "";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      system: params.system,
      messages: [{ role: "user", content: prompt }],
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const textBlock = response.content.find((block) => block.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text : "";
    lastText = text;

    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch (err) {
      if (attempt > maxRetries) {
        throw new Error(`Claudeの応答をJSONとして解釈できませんでした(${attempt}回試行): ${text.slice(0, 500)}`);
      }
      prompt = buildRetryPrompt(params.prompt, text, `JSONとして解釈できません: ${(err as Error).message}`);
      continue;
    }

    const result = params.schema.safeParse(parsed);
    if (result.success) {
      return {
        data: result.data,
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        model,
        estimated_cost: estimateCostUsd(model, totalInputTokens, totalOutputTokens),
        raw_text: lastText,
        attempts: attempt,
      };
    }

    if (attempt > maxRetries) {
      throw new Error(`Claudeの応答がスキーマに一致しませんでした(${attempt}回試行): ${result.error.message}`);
    }
    prompt = buildRetryPrompt(params.prompt, text, result.error.message);
  }

  // 型上到達しないが、TypeScriptのnarrowingのために明示しておく。
  throw new Error("callClaudeStructured: unreachable");
}

function buildRetryPrompt(originalPrompt: string, previousResponse: string, errorMessage: string): string {
  return `${originalPrompt}

---
前回の出力はスキーマに違反していました。
前回の出力:
${previousResponse.slice(0, 2000)}

エラー内容:
${errorMessage}

上記エラーを修正し、JSONのみを出力してください(説明文・コードフェンス不要)。`;
}
