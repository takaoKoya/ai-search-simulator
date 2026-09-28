// Claude API 料金表(USD / 100万トークン)。モデル追加・値上げ時はここだけ更新すればよい。
// 参照: Anthropic公式料金ページ(2026年時点)。
const MODEL_PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

// 未知のモデルIDの場合に備えたフォールバック(Sonnet系の価格帯を仮定)。
// 実コストと乖離しうるため、Settings画面の使用量表示では概算である旨を明記すること。
const FALLBACK_PRICING = { input: 3.0, output: 15.0 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_PER_MILLION_TOKENS[model] ?? FALLBACK_PRICING;
  const cost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
