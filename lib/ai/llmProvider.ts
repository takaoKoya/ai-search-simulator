/**
 * LLMProvider abstraction (spec §6/FINAL CHANGE 6) — the only seam through
 * which a real LLM enters this codebase in PHASE 1, and only ever consumed by
 * CompanyPlanner (lib/autonomy/planner.ts). Never wired into the 18 existing
 * LangGraph pipelines.
 *
 * Fail-Closed selection (spec §6, corrected during design): Mock is
 * permitted only when autonomyMode is OFF or SHADOW. ASSISTED/ACTIVE
 * unconditionally require a configured real provider — there is no
 * environment-based (NODE_ENV, etc.) bypass anywhere in getLLMProvider. A
 * missing/unconfigured real provider in ASSISTED/ACTIVE throws
 * LLMProviderUnavailableError; it never silently falls back to Mock.
 */

import type { ZodType } from "zod";
import type { AutonomyMode } from "@/lib/autonomy/types";
import { AnthropicLLMProvider } from "@/lib/ai/anthropicLLMProvider";

export type ProviderKind = "REAL" | "MOCK";

export class LLMProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMProviderUnavailableError";
  }
}

export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

export class LLMRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMRateLimitError";
  }
}

export class LLMServerError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "LLMServerError";
  }
}

export class LLMNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMNetworkError";
  }
}

export class LLMMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMMalformedResponseError";
  }
}

export class LLMSchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly issues?: unknown
  ) {
    super(message);
    this.name = "LLMSchemaValidationError";
  }
}

export interface LLMGenerateParams {
  prompt: string;
  system?: string;
  timeoutMs?: number;
}

export interface LLMCallResult<T> {
  data: T;
  providerKind: ProviderKind;
}

export interface LLMProvider {
  readonly kind: ProviderKind;
  generateStructured<T>(schema: ZodType<T>, params: LLMGenerateParams): Promise<LLMCallResult<T>>;
  generateText(params: LLMGenerateParams): Promise<LLMCallResult<string>>;
}

/** Deterministically scripted provider for OFF/SHADOW and tests — never used as an ASSISTED/ACTIVE fallback. */
export type MockRespondFn = (prompt: string, system?: string) => unknown;

export class MockLLMProvider implements LLMProvider {
  readonly kind: ProviderKind = "MOCK";

  constructor(private readonly respond: MockRespondFn) {}

  async generateStructured<T>(schema: ZodType<T>, params: LLMGenerateParams): Promise<LLMCallResult<T>> {
    const raw = this.respond(params.prompt, params.system);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new LLMSchemaValidationError(`Mock response failed schema validation: ${parsed.error.message}`, parsed.error.issues);
    }
    return { data: parsed.data, providerKind: "MOCK" };
  }

  async generateText(params: LLMGenerateParams): Promise<LLMCallResult<string>> {
    const raw = this.respond(params.prompt, params.system);
    return { data: String(raw), providerKind: "MOCK" };
  }
}

export interface GetLLMProviderOptions {
  /** Required to obtain a Mock provider in OFF/SHADOW when no real provider is configured. */
  mockRespond?: MockRespondFn;
  /** Test/override hook — production always reads process.env.ANTHROPIC_API_KEY. */
  apiKeyOverride?: string;
  timeoutMs?: number;
}

/**
 * Selects the LLMProvider for a given autonomy mode. See module doc comment
 * for the Fail-Closed contract this enforces — in particular, the
 * `mockAllowed` check below runs *before* anything else and never
 * consults process.env.NODE_ENV or any other environment signal.
 */
export function getLLMProvider(autonomyMode: AutonomyMode, options: GetLLMProviderOptions = {}): LLMProvider {
  const mockAllowed = autonomyMode === "OFF" || autonomyMode === "SHADOW";
  const apiKey = options.apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    return new AnthropicLLMProvider(apiKey, options.timeoutMs);
  }

  if (!mockAllowed) {
    throw new LLMProviderUnavailableError(
      `Real LLM provider is required in autonomy mode ${autonomyMode} and no ANTHROPIC_API_KEY is configured. Mock fallback is not permitted outside OFF/SHADOW.`
    );
  }

  if (!options.mockRespond) {
    throw new LLMProviderUnavailableError(`No real LLM provider is configured and no mockRespond was supplied for autonomy mode ${autonomyMode}.`);
  }
  return new MockLLMProvider(options.mockRespond);
}
