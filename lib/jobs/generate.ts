import OpenAI from "openai";
import { generatedJobSchema, type GeneratedJob } from "./schema";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

const SYSTEM_PROMPT = `あなたは日本の採用マーケティングの専門家です。
ユーザーが入力したざっくりした求人条件から、以下を日本語で生成し、指定のJSON形式のみで返してください。

- targetType: ターゲット層の判定。
  ALBAIT=アルバイト・パート・短期/単発 / SPECIALIST=専門職・有資格者・エンジニア・医療介護など / GENERAL=上記以外の一般的な正社員・契約社員
- snsPostText: x(140字以内・ハッシュタグ付き) / instagram(親しみやすい文体・ハッシュタグ多め) / line(友だち向けの短い案内)。ターゲットに響くトーンにする
- indeedText: Indeed向け構造化求人原稿。「【仕事内容】【応募資格】【給与】【勤務地】【勤務時間・休日】【待遇・福利厚生】【選考プロセス】」の見出しで構成する
- lineQuestions: LINEで応募者に聞くスクリーニング質問をちょうど3つ。各質問に選択肢(2〜4個)を付ける。ターゲット層と職種に即した、応募意欲・必須条件・稼働可能時期などを確認する内容にする

入力に書かれていない給与・待遇・資格などの事実を捏造しないこと。不明な項目は「応募後にご案内します」等の表現にする。`;

const JSON_SCHEMA = {
  name: "generated_job",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["targetType", "snsPostText", "indeedText", "lineQuestions"],
    properties: {
      targetType: { type: "string", enum: ["ALBAIT", "SPECIALIST", "GENERAL"] },
      snsPostText: {
        type: "object",
        additionalProperties: false,
        required: ["x", "instagram", "line"],
        properties: {
          x: { type: "string" },
          instagram: { type: "string" },
          line: { type: "string" },
        },
      },
      indeedText: { type: "string" },
      lineQuestions: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "options"],
          properties: {
            question: { type: "string" },
            options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
          },
        },
      },
    },
  },
} as const;

export class GenerationError extends Error {}

let client: OpenAI | undefined;

export async function generateJobContent(text: string): Promise<GeneratedJob> {
  if (!process.env.OPENAI_API_KEY) {
    throw new GenerationError("OPENAI_API_KEY が設定されていません");
  }
  client ??= new OpenAI();

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.7,
    response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) throw new GenerationError("AIから応答がありませんでした");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new GenerationError("AIの応答をJSONとして解釈できませんでした");
  }
  const result = generatedJobSchema.safeParse(parsed);
  if (!result.success) throw new GenerationError("AIの応答が想定した形式ではありません");
  return result.data;
}
