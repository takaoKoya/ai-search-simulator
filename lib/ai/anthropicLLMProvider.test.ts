import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicLLMProvider } from "@/lib/ai/anthropicLLMProvider";
import { LLMMalformedResponseError, LLMNetworkError, LLMRateLimitError, LLMSchemaValidationError, LLMServerError, LLMTimeoutError } from "@/lib/ai/llmProvider";

function textResponse(text: string) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
}

describe("AnthropicLLMProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generateText posts to the Messages API and returns providerKind REAL", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(textResponse("hello there"));

    const provider = new AnthropicLLMProvider("sk-test");
    const result = await provider.generateText({ prompt: "hi", system: "be nice" });
    expect(result).toEqual({ data: "hello there", providerKind: "REAL" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("be nice");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("generateStructured parses JSON out of the response text and validates it against the schema", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(textResponse('```json\n{"decision":"WAIT"}\n```'));

    const provider = new AnthropicLLMProvider("sk-test");
    const schema = z.object({ decision: z.enum(["WAIT", "NO_ACTION"]) });
    const result = await provider.generateStructured(schema, { prompt: "plan" });
    expect(result).toEqual({ data: { decision: "WAIT" }, providerKind: "REAL" });
  });

  it("throws LLMMalformedResponseError when the response text is not valid JSON", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(textResponse("not json at all"));

    const provider = new AnthropicLLMProvider("sk-test");
    await expect(provider.generateStructured(z.object({}), { prompt: "plan" })).rejects.toBeInstanceOf(LLMMalformedResponseError);
  });

  it("throws LLMSchemaValidationError when the parsed JSON does not match the schema", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(textResponse('{"decision":"NOT_VALID"}'));

    const provider = new AnthropicLLMProvider("sk-test");
    const schema = z.object({ decision: z.enum(["WAIT", "NO_ACTION"]) });
    await expect(provider.generateStructured(schema, { prompt: "plan" })).rejects.toBeInstanceOf(LLMSchemaValidationError);
  });

  it("throws LLMRateLimitError on a 429 (after fetchWithRetry's retries are exhausted)", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null }, text: async () => "rate limited" });

      const provider = new AnthropicLLMProvider("sk-test");
      const assertion = expect(provider.generateText({ prompt: "hi" })).rejects.toBeInstanceOf(LLMRateLimitError);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws LLMServerError on a 500 (after fetchWithRetry's retries are exhausted)", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue({ ok: false, status: 500, headers: { get: () => null }, text: async () => "server error" });

      const provider = new AnthropicLLMProvider("sk-test");
      const assertion = expect(provider.generateText({ prompt: "hi" })).rejects.toBeInstanceOf(LLMServerError);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws LLMMalformedResponseError on a non-retryable 4xx", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "unauthorized" });

    const provider = new AnthropicLLMProvider("sk-test");
    await expect(provider.generateText({ prompt: "hi" })).rejects.toBeInstanceOf(LLMMalformedResponseError);
  });

  it("throws LLMNetworkError when fetch itself rejects", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

    const provider = new AnthropicLLMProvider("sk-test");
    await expect(provider.generateText({ prompt: "hi" })).rejects.toBeInstanceOf(LLMNetworkError);
  });

  it("throws LLMTimeoutError when the request is aborted for taking too long", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const provider = new AnthropicLLMProvider("sk-test", 5);
    await expect(provider.generateText({ prompt: "hi" })).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it("throws LLMMalformedResponseError when the response has no text content block", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: [] }) });

    const provider = new AnthropicLLMProvider("sk-test");
    await expect(provider.generateText({ prompt: "hi" })).rejects.toBeInstanceOf(LLMMalformedResponseError);
  });
});
