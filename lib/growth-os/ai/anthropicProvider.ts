import { callClaudeStructured } from "@/lib/growth-os/claude/client";
import {
  researchAnalysisSchema,
  ideaGenerationResponseSchema,
  ideaScoreResponseSchema,
  type ResearchAnalysis,
  type GeneratedIdea,
  type IdeaScoreResponse,
} from "@/lib/growth-os/ai/schemas";
import { IDEA_SCORE_CRITERIA } from "@/lib/growth-os/types";
import type {
  AIProvider,
  AnalyzeResearchInput,
  GenerateIdeasInput,
  ScoreIdeaInput,
  StructuredResult,
} from "@/lib/growth-os/ai/types";

// 全Agent共通のブランド文脈。プロンプトの重複を避けるためここに集約する。
const BRAND_CONTEXT = `【対象読者】日本の45〜59歳程度の会社員。
【中心テーマ】50代／会社依存／AIによる仕事不安／副業／定年／転職／老後／第二キャリア／人生再設計。
【中心思想】「会社を辞めなくていい。でも、会社がなくても生きられる自分は作っておこう。」

【厳守事項・禁止表現】
- 根拠のない煽り
- 「AIで簡単に稼げる」という表現
- 「月◯万円を簡単に稼げる」という断定的な保証
- 架空の体験談・架空の統計・架空の引用・架空の専門家コメント
- 過剰な恐怖訴求`;

const CRITERIA_TEXT = IDEA_SCORE_CRITERIA.map((c) => `- ${c.key} (${c.label}, 満点${c.weight}点)`).join("\n");

function toUsage<T>(result: {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  estimated_cost: number;
  raw_text: string;
  attempts: number;
}): StructuredResult<T> {
  return {
    data: result.data,
    raw_text: result.raw_text,
    usage: {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      model: result.model,
      estimated_cost: result.estimated_cost,
      attempts: result.attempts,
    },
  };
}

class AnthropicAIProvider implements AIProvider {
  async analyzeResearch(input: AnalyzeResearchInput): Promise<StructuredResult<ResearchAnalysis>> {
    const system = `あなたは「50代note Growth OS」のResearch Analysis Agentです。
${BRAND_CONTEXT}

市場調査メモを読み、以下を抽出してください。
- harm_types: Health/Ambition/Relation/Money のうち該当するもの全て(複合的な悩みは複数選択する)
- surface_problem: 本人が自覚している表面的な悩み
- deep_problem: その裏にある、本人も言語化できていない本質的な恐怖・欲求
- emotional_trigger: その悩みが強まる引き金となる出来事(例: 定年・リストラ・AI普及のニュース等)
- trend_score / pain_score: 0〜100の整数と、その理由

単なる分類だけでなく、なぜそう判断したかを reasoning に必ず書くこと。
出力は指定のJSONスキーマのみ。`;

    const prompt = `出典: ${input.sourceName}
検索語: ${input.keyword ?? "(なし)"}
タイトル: ${input.title}
要約: ${input.summary ?? "(なし)"}
原文/メモ: ${input.rawText ?? "(なし)"}

以下のJSONスキーマで出力してください:
{
  "harm_types": ["Health" | "Ambition" | "Relation" | "Money", ...],
  "surface_problem": string,
  "deep_problem": string,
  "emotional_trigger": string,
  "trend_score": number,
  "pain_score": number,
  "reasoning": string
}`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: researchAnalysisSchema,
      maxTokens: 1536,
      temperature: 0.2,
    });
    return toUsage(result);
  }

  async generateIdeas(input: GenerateIdeasInput): Promise<StructuredResult<GeneratedIdea[]>> {
    const ideaCount = input.ideaCount ?? (input.sources.length > 1 ? 3 : 1);

    const system = `あなたは「50代note Growth OS」のIdea Generator Agentです。
${BRAND_CONTEXT}

与えられたResearch(複数の場合あり)を根拠に、コンテンツテーマ候補を${ideaCount}件作成してください。
「よくあるAI副業記事」(悪い例: 「50代におすすめのAI副業5選」)は絶対に避け、
人物 × 状況 × 感情 × トレンド まで具体化すること。
良い例: 「50代。会社がなくなったら、自分には何が残るんだろう。」

各テーマについて:
- title: 上記の良い例のような、具体的で感情に触れるテーマ名
- hook: 読者の注意を引く一文
- angle: このテーマをどの切り口で語るか
- target_persona: 想定読者像(年齢・職種・状況を具体的に)
- core_problem: このテーマが解決しようとする中心課題
- harm_types: 該当するHARM区分(複数可)
- recommended_format / recommended_free_or_paid: あくまでAIの提案であり、最終判断は人間が行う

出力は指定のJSONスキーマのみ。`;

    const sourcesText = input.sources
      .map(
        (s, i) =>
          `[Research ${i + 1}] タイトル: ${s.title}\n要約: ${s.summary ?? "(なし)"}\n表面的悩み: ${s.surfaceProblem ?? "(なし)"}\n深層の悩み: ${s.deepProblem ?? "(なし)"}\n感情トリガー: ${s.emotionalTrigger ?? "(なし)"}\nHARM: ${s.harmTypes.join("/") || "(なし)"}`
      )
      .join("\n\n");

    const prompt = `以下のResearchを根拠に、コンテンツテーマ候補を${ideaCount}件作成してください。

${sourcesText}

以下のJSONスキーマで出力してください:
{
  "ideas": [
    {
      "title": string, "hook": string, "angle": string, "target_persona": string,
      "core_problem": string, "harm_types": ["Ambition", ...],
      "recommended_format": "THREADS" | "NOTE_FREE" | "NOTE_PAID" | "BOTH",
      "recommended_free_or_paid": "FREE" | "PAID" | "EITHER"
    }
  ]
}`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: ideaGenerationResponseSchema,
      maxTokens: 3072,
      temperature: 0.6,
    });
    return toUsage({ ...result, data: result.data.ideas });
  }

  async scoreIdea(input: ScoreIdeaInput): Promise<StructuredResult<IdeaScoreResponse>> {
    const system = `あなたは「50代note Growth OS」のIdea Scorer Agentです。
${BRAND_CONTEXT}

コンテンツ企画テーマを、以下9軸・合計100点で採点してください。
${CRITERIA_TEXT}

各軸ごとに score(0〜満点の数値)・reason(なぜその点数か)・evidence(何を根拠にしたか、
具体的な事実や与えられたResearchの要約を引用すること)を必ず組で返してください。
「92点」のように点数だけを述べることは禁止します。

さらに confidence_self_assessment(0〜100)として、
「この採点にどれだけ自信があるか」をあなた自身の判断で申告してください。
これは最終的な信頼度スコアの入力の1つに過ぎず、他の客観的指標と合わせてアプリ側で最終計算されます。

出力は指定のJSONスキーマのみ。`;

    const evidenceText =
      input.evidenceSummaries.length > 0
        ? input.evidenceSummaries.map((e, i) => `[根拠${i + 1}] ${e}`).join("\n")
        : "(根拠となるResearchなし。手動登録されたテーマの可能性が高いため、根拠不足を前提に評価すること)";

    const prompt = `タイトル: ${input.title}
Hook: ${input.hook ?? "(なし)"}
切り口: ${input.angle ?? "(なし)"}
ターゲット: ${input.targetPersona ?? "(なし)"}
中心課題: ${input.coreProblem ?? "(なし)"}

根拠情報:
${evidenceText}

以下のJSONスキーマで出力してください(criterionは英語キーのまま):
{
  "scores": [
    { "criterion": "demand", "score": number, "reason": string, "evidence": string },
    { "criterion": "pain", "score": number, "reason": string, "evidence": string },
    { "criterion": "willingness_to_pay", "score": number, "reason": string, "evidence": string },
    { "criterion": "competition_opportunity", "score": number, "reason": string, "evidence": string },
    { "criterion": "trend", "score": number, "reason": string, "evidence": string },
    { "criterion": "threads_virality", "score": number, "reason": string, "evidence": string },
    { "criterion": "note_fit", "score": number, "reason": string, "evidence": string },
    { "criterion": "product_connection", "score": number, "reason": string, "evidence": string },
    { "criterion": "user_fit", "score": number, "reason": string, "evidence": string }
  ],
  "confidence_self_assessment": number
}`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: ideaScoreResponseSchema,
      maxTokens: 3072,
      temperature: 0.2,
    });
    return toUsage(result);
  }
}

let provider: AIProvider | null = null;

/** アプリ全体で共有するAIProviderのシングルトン取得口。テストではモックに差し替え可能。 */
export function getAIProvider(): AIProvider {
  if (!provider) {
    provider = new AnthropicAIProvider();
  }
  return provider;
}
