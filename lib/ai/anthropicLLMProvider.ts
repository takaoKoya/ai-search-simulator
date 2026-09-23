/**
 * Real LLM provider for CompanyPlanner (spec §6). Raw `fetch` against
 * Anthropic's Messages API, mirroring the existing fetch-based external-API
 * connector pattern (lib/integrations/googleGmailConnector.ts) rather than
 * adding an SDK dependency. Structured output is obtained via an explicit
 * "respond with JSON only" instruction appended to the prompt, not via a
 * tool-use/JSON-schema API parameter — no zod-to-json-schema dependency
 * exists in this codebase and PHASE 1 does not add one.
 */

import type { ZodType } from "zod";
import { fetchWithRetry } from "@/lib/integrations/httpRetry";
import {
  LLMMalformedResponseError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMSchemaValidationError,
  LLMServerError,
  LLMTimeoutError,
  type LLMCallResult,
  type LLMGenerateParams,
  type LLMProvider,
  type ProviderKind,
} from "@/lib/ai/llmProvider";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 4096;

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export class AnthropicLLMProvider implements LLMProvider {
  readonly kind: ProviderKind = "REAL";
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {
    this.model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async generateText(params: LLMGenerateParams): Promise<LLMCallResult<string>> {
    const text = await this.callAnthropic(params);
    return { data: text, providerKind: "REAL" };
  }

  async generateStructured<T>(schema: ZodType<T>, params: LLMGenerateParams): Promise<LLMCallResult<T>> {
    const jsonOnlyPrompt = `${params.prompt}\n\nRespond with ONLY a single valid JSON object matching the required shape. No markdown code fences, no commentary, no explanation before or after — JSON only.`;
    const text = await this.callAnthropic({ ...params, prompt: jsonOnlyPrompt });

    let raw: unknown;
    try {
      raw = JSON.parse(extractJsonPayload(text));
    } catch (err) {
      throw new LLMMalformedResponseError(`Anthropic response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new LLMSchemaValidationError(`Anthropic response failed schema validation: ${parsed.error.message}`, parsed.error.issues);
    }
    return { data: parsed.data, providerKind: "REAL" };
  }

  private async callAnthropic(params: LLMGenerateParams): Promise<string> {
    const timeoutMs = params.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetchWithRetry(ANTHROPIC_API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          ...(params.system ? { system: params.system } : {}),
          messages: [{ role: "user", content: params.prompt }],
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMTimeoutError(`Anthropic request timed out after ${timeoutMs}ms`);
      }
      throw new LLMNetworkError(`Anthropic request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      throw new LLMRateLimitError("Anthropic rate limit exceeded (429)");
    }
    if (res.status >= 500) {
      throw new LLMServerError(`Anthropic server error (${res.status})`, res.status);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMMalformedResponseError(`Anthropic request rejected (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = data.content?.find((block) => block.type === "text");
    if (!textBlock?.text) {
      throw new LLMMalformedResponseError("Anthropic response contained no text content block");
    }
    return textBlock.text;
  }
}
