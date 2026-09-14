import "server-only";
import Anthropic from "@anthropic-ai/sdk";

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
