import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLLMProvider } from "@/lib/ai/anthropicLLMProvider";
import { getLLMProvider, LLMProviderUnavailableError, LLMSchemaValidationError, MockLLMProvider } from "@/lib/ai/llmProvider";

const Schema = z.object({ decision: z.enum(["NO_ACTION", "CREATE_WORK"]) });

describe("MockLLMProvider", () => {
  it("returns providerKind MOCK and the scripted value when it matches the schema", async () => {
    const provider = new MockLLMProvider(() => ({ decision: "CREATE_WORK" }));
    const result = await provider.generateStructured(Schema, { prompt: "plan" });
    expect(result).toEqual({ data: { decision: "CREATE_WORK" }, providerKind: "MOCK" });
  });

  it("throws LLMSchemaValidationError when the scripted response does not match the schema", async () => {
    const provider = new MockLLMProvider(() => ({ decision: "NOT_A_VALID_DECISION" }));
    await expect(provider.generateStructured(Schema, { prompt: "plan" })).rejects.toBeInstanceOf(LLMSchemaValidationError);
  });

  it("generateText stringifies the scripted response", async () => {
    const provider = new MockLLMProvider(() => "hello");
    const result = await provider.generateText({ prompt: "hi" });
    expect(result).toEqual({ data: "hello", providerKind: "MOCK" });
  });
});

describe("getLLMProvider (Fail-Closed selection)", () => {
  it("returns a MockLLMProvider in OFF mode when no real provider is configured", () => {
    const provider = getLLMProvider("OFF", { mockRespond: () => ({}) });
    expect(provider).toBeInstanceOf(MockLLMProvider);
  });

  it("returns a MockLLMProvider in SHADOW mode when no real provider is configured", () => {
    const provider = getLLMProvider("SHADOW", { mockRespond: () => ({}) });
    expect(provider).toBeInstanceOf(MockLLMProvider);
  });

  it("throws LLMProviderUnavailableError in OFF mode when no mockRespond and no api key are given", () => {
    expect(() => getLLMProvider("OFF", {})).toThrow(LLMProviderUnavailableError);
  });

  it("prefers a real provider over Mock even in SHADOW mode when an api key is configured", () => {
    const provider = getLLMProvider("SHADOW", { apiKeyOverride: "sk-test", mockRespond: () => ({}) });
    expect(provider).toBeInstanceOf(AnthropicLLMProvider);
  });

  it("throws LLMProviderUnavailableError (never falls back to Mock) in ASSISTED mode with no api key, even if mockRespond is supplied", () => {
    expect(() => getLLMProvider("ASSISTED", { mockRespond: () => ({ decision: "NO_ACTION" }) })).toThrow(LLMProviderUnavailableError);
  });

  it("throws LLMProviderUnavailableError (Mock Prohibition) in ACTIVE mode with no api key, even if mockRespond is supplied", () => {
    expect(() => getLLMProvider("ACTIVE", { mockRespond: () => ({ decision: "NO_ACTION" }) })).toThrow(LLMProviderUnavailableError);
  });

  it("returns a real AnthropicLLMProvider in ACTIVE mode when an api key is configured", () => {
    const provider = getLLMProvider("ACTIVE", { apiKeyOverride: "sk-test" });
    expect(provider).toBeInstanceOf(AnthropicLLMProvider);
    expect(provider.kind).toBe("REAL");
  });

  it("returns a real AnthropicLLMProvider in ASSISTED mode when an api key is configured", () => {
    const provider = getLLMProvider("ASSISTED", { apiKeyOverride: "sk-test" });
    expect(provider).toBeInstanceOf(AnthropicLLMProvider);
    expect(provider.kind).toBe("REAL");
  });
});
