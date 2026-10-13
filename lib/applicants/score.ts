import { z } from "zod";
import { getOpenAI, OPENAI_MODEL } from "@/lib/openai";
import type { LineQuestion } from "@/lib/jobs/schema";

export const scoreResultSchema = z.object({
  score: z.number().min(0).max(100),
  evaluation: z.string().min(1),
  status: z.enum(["PASSED", "REJECTED", "PENDING"]),
});
export type ScoreResult = z.infer<typeof scoreResultSchema>;

export type ScoreInput = {
  job: { title: string; location: string; salary: string; conditions: string; targetType: string; indeedText: string };
  questions: LineQuestion[];
  answers: string[];
  interviewAt: Date;
};

const SYSTEM_PROMPT = `あなたは採用担当者を補助する一次スクリーニングのアシスタントです。
求人条件と、LINEで取得した応募者の回答をもとに、募集要件への適合度を評価してください。

出力ルール:
- score: 0〜100の整数。募集要件・必須条件との適合度のみで評価する
- evaluation: 判断の根拠を日本語で2〜3文。どの回答が加点/減点になったかを具体的に書く
- status: PASSED=要件を満たし面接に進めてよい / REJECTED=必須条件を明確に満たさない / PENDING=情報不足や判断に迷う場合

注意:
- 年齢・性別・国籍・出身・家族構成など、職務と無関係な属性で評価してはならない
- 回答に表れていない事実を推測で補わない。根拠が弱い場合は REJECTED ではなく PENDING にする
- 最終判断は人間の採用担当者が行う。あくまで参考評価として出力する`;

const JSON_SCHEMA = {
  name: "applicant_score",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["score", "evaluation", "status"],
    properties: {
      score: { type: "integer" },
      evaluation: { type: "string" },
      status: { type: "string", enum: ["PASSED", "REJECTED", "PENDING"] },
    },
  },
} as const;

export function buildScoringPrompt({ job, questions, answers, interviewAt }: ScoreInput): string {
  const qa = questions
    .map((q, i) => `Q${i + 1}. ${q.question}\n選択肢: ${q.options.join(" / ")}\n回答: ${answers[i] ?? "(未回答)"}`)
    .join("\n\n");
  return [
    "## 求人条件",
    `職種: ${job.title}`,
    `勤務地: ${job.location || "未記載"}`,
    `給与: ${job.salary || "未記載"}`,
    `条件: ${job.conditions || "未記載"}`,
    `ターゲット層: ${job.targetType}`,
    "",
    "## 求人原稿",
    job.indeedText,
    "",
    "## 応募者の回答",
    qa,
    "",
    `面接希望日時: ${interviewAt.toISOString()}`,
  ].join("\n");
}

/** 異常値を丸めて検証する。不正な形式なら null。 */
export function parseScoreResult(raw: unknown): ScoreResult | null {
  const parsed = scoreResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { ...parsed.data, score: Math.round(parsed.data.score) };
}

export async function scoreApplicant(input: ScoreInput): Promise<ScoreResult> {
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildScoringPrompt(input) },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("scoring: empty response");
  const result = parseScoreResult(JSON.parse(content));
  if (!result) throw new Error("scoring: invalid response shape");
  return result;
}
