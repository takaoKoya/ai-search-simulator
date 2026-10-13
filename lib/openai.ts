import OpenAI from "openai";

let client: OpenAI | undefined;

export class MissingApiKeyError extends Error {
  constructor() {
    super("OPENAI_API_KEY が設定されていません");
  }
}

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new MissingApiKeyError();
  return (client ??= new OpenAI());
}

export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";
