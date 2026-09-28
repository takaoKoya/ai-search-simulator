import { callClaudeStructured } from "@/lib/growth-os/claude/client";
import { getModelForRole } from "@/lib/growth-os/ai/modelStrategy";
import {
  researchAnalysisSchema,
  ideaGenerationResponseSchema,
  ideaScoreResponseSchema,
  contentStrategySchema,
  threadsGenerationResponseSchema,
  threadsScoreResponseSchema,
  threadsDraftSchema,
  outlineResponseSchema,
  sectionDraftSchema,
  articleReviewResponseSchema,
  factCheckResponseSchema,
  salesEditResponseSchema,
  paidCandidateEvaluationSchema,
  type ResearchAnalysis,
  type GeneratedIdea,
  type IdeaScoreResponse,
  type ContentStrategyDraft,
  type ThreadsDraft,
  type ThreadsScoreResponse,
  type OutlineResponse,
  type SectionDraft,
  type ArticleReviewResponse,
  type FactCheckResponse,
  type SalesEditResponse,
  type PaidCandidateEvaluationDraft,
} from "@/lib/growth-os/ai/schemas";
import { IDEA_SCORE_CRITERIA } from "@/lib/growth-os/types";
import type {
  AIProvider,
  AnalyzeResearchInput,
  GenerateIdeasInput,
  ScoreIdeaInput,
  StructuredResult,
  GenerateStrategyInput,
  GenerateThreadsInput,
  ScoreThreadsInput,
  RewriteThreadsInput,
  GenerateOutlineInput,
  DraftSectionInput,
  ReviewArticleInput,
  FactCheckInput,
  SalesEditInput,
  EvaluatePaidCandidateInput,
  ExperienceEntryInput,
  WritingProfileContext,
  SourceEntryInput,
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

// フェーズ3: 架空体験の生成を禁止する共通ルール。Threads/Section執筆系プロンプトすべてに含める。
const EXPERIENCE_RULE = `【体験に関する絶対ルール】
一人称の体験談(「私は〜」「実際に〜した」等)を書く場合、必ず後述のExperience Libraryに
存在する内容だけを使うこと。使用した場合はexperience_ids_usedに該当IDをそのまま入れること。
Experience Libraryに該当する体験が無い場合、一人称の体験談を書いてはならない。
代わりに「一般的なケースでは」「調査で見えてきたこととして」のように一般論として書くか、
体験を必要とする箇所は具体的なエピソードを空欄にして needs_user_story(またはneeds_user_input)をtrueにすること。
Experience Libraryに存在しないID・存在しない体験を作り出すことは固く禁止する。`;

function experienceLibraryText(experiences: ExperienceEntryInput[]): string {
  if (experiences.length === 0) return "(登録されている体験はありません。一人称の体験談は書けません)";
  return experiences
    .map((e) => `[EXP:${e.id}] ${e.title}: ${e.summary}${e.tags.length ? ` (タグ: ${e.tags.join("/")})` : ""}`)
    .join("\n");
}

function writingProfileText(profile: WritingProfileContext | null): string {
  if (!profile) return "(未設定。標準的で読みやすい文体で書く)";
  return `文体トーン: ${profile.preferredTone || "(未指定)"}
文の長さ: ${profile.sentenceLength} / ユーモア度: ${profile.humorLevel} / 率直さ: ${profile.directness}
感情表現の強さ: ${profile.emotionalLevel} / 専門用語レベル: ${profile.technicalLevel} / 絵文字使用度: ${profile.emojiLevel}
改行スタイル: ${profile.lineBreakStyle}
NGフレーズ(使用禁止): ${profile.ngPhrases.join("、") || "(なし)"}
好むフレーズ: ${profile.preferredPhrases.join("、") || "(なし)"}`;
}

function sourcesIndexedText(sources: SourceEntryInput[]): string {
  if (sources.length === 0) return "(利用可能なSourceなし。数字・統計・制度・調査結果には触れないこと)";
  return sources.map((s, i) => `[${i}] ${s.title}: ${s.summary ?? ""}`).join("\n");
}

function strategyText(strategy: {
  targetReader: string;
  mainMessage: string;
  uniqueAngle: string;
  desiredAction: string;
} | null): string {
  if (!strategy) return "(Content Strategy未生成)";
  return `ターゲット読者: ${strategy.targetReader}
中心メッセージ: ${strategy.mainMessage}
独自の切り口: ${strategy.uniqueAngle}
読者に取ってほしい行動: ${strategy.desiredAction}`;
}

// AI臭を避けるための共通の文体禁止事項(セクション9・16)。
const AI_SMELL_AVOIDANCE = `【避けるべき文体(AI臭)】
- 不自然に整いすぎた三段構成、過度な箇条書き
- 同じ接続詞・文末表現の多用、「重要なのは〜です」の連発
- 「結論から言うと」「〜なのです」の連発
- 過剰なまとめ、抽象論に終始する、具体的経験の不足
- 不自然なポジティブ結論、テンプレ的CTA、不必要な英語`;

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

  // ------------------------------------------------------------------
  // フェーズ3: Content Strategy → Threads → Outline → Draft → Review → FactCheck
  // ------------------------------------------------------------------

  async generateStrategy(input: GenerateStrategyInput): Promise<StructuredResult<ContentStrategyDraft>> {
    const system = `あなたは「50代note Growth OS」のStrategy Editor Agentです。
${BRAND_CONTEXT}

いきなり文章を書く前に、この企画で「読者をどの状態からどの状態へ動かすか」を設計してください。
例: Before「50代になったけど、何を始めればいいかわからない」→
    After「会社を辞める必要はない。まず自分の経験を棚卸ししてみよう」

target_reader/reader_situation/surface_problem/deep_problem/desired_emotion/desired_action/
main_message/unique_angle/content_goal/free_or_paid/cta_strategy/threads_role/free_note_role/paid_note_role
をすべて具体的に埋めてください。paid_note_roleは有料商品との接続性が低いテーマではnullで構いません。
出力は指定のJSONスキーマのみ。`;

    const evidenceText =
      input.evidenceSummaries.length > 0 ? input.evidenceSummaries.map((e, i) => `[根拠${i + 1}] ${e}`).join("\n") : "(根拠情報なし)";

    const prompt = `テーマ: ${input.ideaTitle}
Hook: ${input.hook ?? "(なし)"}
切り口: ${input.angle ?? "(なし)"}
ターゲット: ${input.targetPersona ?? "(なし)"}
中心課題: ${input.coreProblem ?? "(なし)"}
HARM: ${input.harmTypes.join("/") || "(なし)"}
AI推奨(FREE/PAID/EITHER): ${input.recommendedFreeOrPaid ?? "(なし)"}

根拠情報:
${evidenceText}

以下のJSONスキーマで出力してください:
{
  "target_reader": string, "reader_situation": string, "surface_problem": string, "deep_problem": string,
  "desired_emotion": string, "desired_action": string, "main_message": string, "unique_angle": string,
  "content_goal": string, "free_or_paid": "FREE" | "PAID" | "BOTH", "cta_strategy": string,
  "threads_role": string, "free_note_role": string, "paid_note_role": string | null
}`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: contentStrategySchema,
      model: getModelForRole("STANDARD"),
      maxTokens: 2048,
      temperature: 0.4,
    });
    return toUsage(result);
  }

  async generateThreads(input: GenerateThreadsInput): Promise<StructuredResult<ThreadsDraft[]>> {
    const system = `あなたは「50代note Growth OS」のThreads Content Engineです。
${BRAND_CONTEXT}

以下5パターンを1件ずつ、必ずこの順番で作成してください。
1. EMPATHY(共感型) 2. PROBLEM(問題提起型) 3. FAILURE(体験・ストーリー型)
4. QUESTION(問いかけ型) 5. CONTRARIAN(逆説・意外性型)

各投稿は日本語で200〜400文字、絵文字は使わず、押し付けがましい売り込み口調を避けてください。
${EXPERIENCE_RULE}
特に3番目(体験・ストーリー型)は一人称エピソードが主役のパターンのため、このルールを厳守すること。

${AI_SMELL_AVOIDANCE}

【Content Strategy】
${strategyText(input.strategy)}

【Experience Library】
${experienceLibraryText(input.experiences)}

【Writing Profile】
${writingProfileText(input.writingProfile)}

出力は指定のJSONスキーマのみ。`;

    const prompt = `テーマ: ${input.ideaTitle}

以下のJSONスキーマで出力してください:
{
  "posts": [
    { "pattern_type": "EMPATHY", "body": string, "experience_ids_used": string[], "needs_user_story": boolean },
    { "pattern_type": "PROBLEM", "body": string, "experience_ids_used": string[], "needs_user_story": boolean },
    { "pattern_type": "FAILURE", "body": string, "experience_ids_used": string[], "needs_user_story": boolean },
    { "pattern_type": "QUESTION", "body": string, "experience_ids_used": string[], "needs_user_story": boolean },
    { "pattern_type": "CONTRARIAN", "body": string, "experience_ids_used": string[], "needs_user_story": boolean }
  ]
}`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: threadsGenerationResponseSchema,
      model: getModelForRole("BULK_GENERATE"),
      maxTokens: 3072,
      temperature: 0.6,
    });
    return toUsage({ ...result, data: result.data.posts });
  }

  async scoreThreads(input: ScoreThreadsInput): Promise<StructuredResult<ThreadsScoreResponse>> {
    const system = `あなたは「50代note Growth OS」のThreads品質評価Agentです。
以下9軸を0〜100で評価し、必ず各軸にreasonを付けてください。
hook/empathy/humanity/clarity/shareabilityは高いほど良く、
sales_smell/ai_smell/preachiness/fearは低いほど良い評価です。
出力は指定のJSONスキーマのみ。`;

    const prompt = `パターン: ${input.patternType}
本文:
${input.body}

以下のJSONスキーマで出力してください:
{ "scores": [
  { "criterion": "hook", "score": number, "reason": string },
  { "criterion": "empathy", "score": number, "reason": string },
  { "criterion": "humanity", "score": number, "reason": string },
  { "criterion": "clarity", "score": number, "reason": string },
  { "criterion": "shareability", "score": number, "reason": string },
  { "criterion": "sales_smell", "score": number, "reason": string },
  { "criterion": "ai_smell", "score": number, "reason": string },
  { "criterion": "preachiness", "score": number, "reason": string },
  { "criterion": "fear", "score": number, "reason": string }
] }`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: threadsScoreResponseSchema,
      model: getModelForRole("STANDARD"),
      maxTokens: 1536,
      temperature: 0.1,
    });
    return toUsage(result);
  }

  async rewriteThreads(input: RewriteThreadsInput): Promise<StructuredResult<ThreadsDraft>> {
    const system = `あなたは「50代note Growth OS」のThreads Rewrite Agentです。
${BRAND_CONTEXT}
${EXPERIENCE_RULE}
${AI_SMELL_AVOIDANCE}

品質評価で指摘された問題点を修正し、同じpattern_typeのまま改善した投稿を1件作成してください。

【Experience Library】
${experienceLibraryText(input.experiences)}

【Writing Profile】
${writingProfileText(input.writingProfile)}

出力は指定のJSONスキーマのみ。`;

    const prompt = `パターン: ${input.patternType}
元の本文:
${input.body}

品質評価での指摘:
${input.scoreFeedback}

以下のJSONスキーマで出力してください:
{ "pattern_type": "${input.patternType}", "body": string, "experience_ids_used": string[], "needs_user_story": boolean }`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: threadsDraftSchema,
      model: getModelForRole("BULK_GENERATE"),
      maxTokens: 1024,
      temperature: 0.5,
    });
    return toUsage(result);
  }

  async generateOutline(input: GenerateOutlineInput): Promise<StructuredResult<OutlineResponse>> {
    const system = `あなたは「50代note Growth OS」のOutline Generator / Title Generator Agentです。
${BRAND_CONTEXT}

本文を書く前に、必ずOutlineを作成します。

タイトルは5案、以下の観点で作成し、それぞれclick_score/trust_score/specificity_score/sales_smell_scoreを付けてください。
共感型・疑問型・告白型・問題提起型・ベネフィット型を1つずつ。煽りすぎ・釣りタイトル・内容と一致しないタイトルは禁止です。
recommended_title_indexで最もおすすめの案(0〜4)を示しますが、最終判断は人間が行います。

sectionsは3〜8個、各Sectionにheading/purpose/key_points/evidence_required(数字や統計に触れるか)/
experience_required(一人称体験が必要か)を設定してください。

ctaは、この記事の目的(${input.articleType === "PAID" ? "有料note" : "無料note"})に応じて
フォロー/次の記事/無料診断/有料note/商品/コメントの中から選び、売り込みすぎない文言にしてください。
無料noteでいきなり高額商品へ誘導しないこと。

【Content Strategy】
${strategyText(input.strategy)}
この記事の役割: ${input.noteRole}

出力は指定のJSONスキーマのみ。`;

    const prompt = `テーマ: ${input.ideaTitle}
中心課題: ${input.coreProblem ?? "(なし)"}

以下のJSONスキーマで出力してください:
{
  "title_candidates": [ { "title": string, "type": "共感"|"疑問"|"告白"|"問題提起"|"ベネフィット", "click_score": number, "trust_score": number, "specificity_score": number, "sales_smell_score": number } ] (5件),
  "recommended_title_index": number,
  "lead": string, "reader_problem": string, "promise": string,
  "sections": [ { "heading": string, "purpose": string, "key_points": string[], "evidence_required": boolean, "experience_required": boolean } ],
  "cta": { "type": "FOLLOW"|"NEXT_ARTICLE"|"FREE_DIAGNOSIS"|"PAID_NOTE"|"PRODUCT"|"COMMENT", "text": string }
}`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: outlineResponseSchema,
      model: getModelForRole("STANDARD"),
      maxTokens: 3072,
      temperature: 0.5,
    });
    return toUsage(result);
  }

  async draftSection(input: DraftSectionInput): Promise<StructuredResult<SectionDraft>> {
    const system = `あなたは「50代note Growth OS」のSection Writer Agentです。
${BRAND_CONTEXT}
${EXPERIENCE_RULE}
${AI_SMELL_AVOIDANCE}

note記事を1つのSection単位で執筆します。短い段落・適度な改行・具体例・問いかけ・実用性を重視し、
過度な箇条書きや同じ表現の繰り返しは避けてください。

${input.evidenceRequired ? "このSectionは数字・統計・制度・調査結果に触れます。必ず下記Sourceに基づいて書き、Source以外の数字を創作しないこと。" : ""}
${input.experienceRequired ? "このSectionは一人称の体験が求められています。Experience Libraryに該当が無ければ空欄化してください。" : ""}

【Content Strategy】
${strategyText(input.strategy)}

【利用可能なSource(数字・統計等に使用可)】
${sourcesIndexedText(input.availableSources)}(source_ids_usedにはSourceのIDをそのまま入れてください)

【Experience Library】
${experienceLibraryText(input.availableExperiences)}

【Writing Profile】
${writingProfileText(input.writingProfile)}

出力は指定のJSONスキーマのみ。`;

    const prompt = `記事タイトル: ${input.articleTitle}
見出し: ${input.heading}
このSectionの目的: ${input.purpose ?? "(なし)"}
盛り込むポイント: ${input.keyPoints.join(" / ")}
${input.precedingSectionsSummary ? `直前までの内容の要約(繰り返しを避けるため):\n${input.precedingSectionsSummary}` : ""}
${input.revisionInstructions ? `\n【編集長からの修正指示(必ず反映すること)】\n${input.revisionInstructions}` : ""}

以下のJSONスキーマで出力してください:
{ "content": string, "experience_ids_used": string[], "source_ids_used": string[], "needs_user_input": boolean }`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: sectionDraftSchema,
      model: getModelForRole("HIGH_QUALITY"),
      maxTokens: 2048,
      temperature: 0.55,
    });
    return toUsage(result);
  }

  async reviewArticle(input: ReviewArticleInput): Promise<StructuredResult<ArticleReviewResponse>> {
    const system = `あなたは3つの視点を1度に担うnote記事レビューチームです。

1. Strategy Editor: Content Strategyで定めた読者・悩み・目的・導線と本文が一致しているか確認する
2. 50代 Reader: 「自分の話だと思えるか」「難しくないか」「説教されている感じがないか」「最後まで読みたいか」を評価する
3. Critical Editor: 冗長・弱い冒頭・同じ話の繰り返し・論理飛躍・AI臭・綺麗すぎる文章を厳しく評価する。
   ai_smell_notesには具体的な該当箇所と理由を列挙すること。revision_instructionsにはWriterがそのまま
   使える修正指示を箇条書きでまとめること。
${AI_SMELL_AVOIDANCE}

さらにhumanity_assessmentとして、具体性・感情の揺れ・失敗・迷い・違和感・自然な言葉・完璧すぎなさ・
本人の経験との接続を評価してください。「人間味を出すために架空の失敗談を作る」ことをスコアの理由に
使ってはいけません(本文に既に含まれる体験の使い方だけを評価対象にすること)。

最後にhook/empathy/clarity/humanity/originality/usefulness/credibility/structure/cta/commercial_potential
の10軸を0〜100で採点し、必ず各軸にreasonを付けてください。

出力は指定のJSONスキーマのみ。`;

    const prompt = `# ${input.title}

${input.fullBody}

【Content Strategy】
${strategyText(input.strategy)}

以下のJSONスキーマで出力してください:
{
  "strategy_alignment": { "verdict": "PASS"|"NEEDS_REVISION"|"FAIL", "feedback": string },
  "reader_reaction": { "verdict": "PASS"|"NEEDS_REVISION"|"FAIL", "feedback": string },
  "critical_editor": { "verdict": "PASS"|"NEEDS_REVISION"|"FAIL", "feedback": string, "ai_smell_notes": string[], "revision_instructions": string },
  "humanity_assessment": { "score": number, "reason": string, "uses_experience": boolean },
  "scores": [
    { "criterion": "hook", "score": number, "reason": string },
    { "criterion": "empathy", "score": number, "reason": string },
    { "criterion": "clarity", "score": number, "reason": string },
    { "criterion": "humanity", "score": number, "reason": string },
    { "criterion": "originality", "score": number, "reason": string },
    { "criterion": "usefulness", "score": number, "reason": string },
    { "criterion": "credibility", "score": number, "reason": string },
    { "criterion": "structure", "score": number, "reason": string },
    { "criterion": "cta", "score": number, "reason": string },
    { "criterion": "commercial_potential", "score": number, "reason": string }
  ]
}`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: articleReviewResponseSchema,
      model: getModelForRole("HIGH_QUALITY"),
      maxTokens: 3072,
      temperature: 0.2,
    });
    return toUsage(result);
  }

  async factCheckArticle(input: FactCheckInput): Promise<StructuredResult<FactCheckResponse>> {
    const system = `あなたはFact Check Agentです。note記事から数字・日付・制度・市場データ・調査結果・
ニュース・企業情報などの事実主張(fact_claims)を抽出してください。

各claimについて、claim(該当箇所の要約)・classification・confidence(0-100)を返してください。
classificationは以下から選ぶこと:
- VERIFIED: 下記Sourceに明確な裏付けがある
- SUPPORTED: Sourceに近い内容の裏付けがある
- UNVERIFIED: 裏付けとなるSourceがない、または不明確
- OPINION: 事実ではなく意見・主観
- EXPERIENCE: 個人の体験談(事実確認の対象外)

裏付けに使ったSourceがあればsource_hint_indexに番号を入れ、無ければnullにしてください。
自分が生成した文章だからといって、根拠なしにVERIFIED/SUPPORTEDと判定してはいけません。

【利用可能なSource】
${(input.availableSources.length > 0 ? input.availableSources : [{ id: "-", title: "(なし)", summary: null }])
  .map((s, i) => `[${i}] ${s.title}: ${s.summary ?? ""}`)
  .join("\n")}

出力は指定のJSONスキーマのみ。`;

    const prompt = `以下のnote記事本文からfact_claimsを抽出してください。

${input.fullBody}

以下のJSONスキーマで出力してください:
{ "claims": [ { "claim": string, "classification": "VERIFIED"|"SUPPORTED"|"UNVERIFIED"|"OPINION"|"EXPERIENCE", "source_hint_index": number | null, "confidence": number } ] }`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: factCheckResponseSchema,
      model: getModelForRole("LIGHT_CLASSIFY"),
      maxTokens: 2048,
      temperature: 0.1,
    });
    return toUsage(result);
  }

  async salesEditArticle(input: SalesEditInput): Promise<StructuredResult<SalesEditResponse>> {
    const system = `あなたはSales Editor Agentです。note記事のCTA・有料導線・売り込み臭を評価してください。
cta_score(CTAの適切さ)とsales_smell_score(売り込み臭、低いほど良い)を0〜100で採点し、
必要であればsuggested_ctaとしてより適切なCTAを提案してください(不要ならnull)。
CTA戦略: ${input.ctaStrategy}
出力は指定のJSONスキーマのみ。`;

    const prompt = `# ${input.title}
種別: ${input.articleType === "PAID" ? `有料note(${input.price ?? "未設定"}円)` : "無料note"}

${input.fullBody}

以下のJSONスキーマで出力してください:
{ "cta_score": number, "sales_smell_score": number, "feedback": string, "suggested_cta": { "type": "FOLLOW"|"NEXT_ARTICLE"|"FREE_DIAGNOSIS"|"PAID_NOTE"|"PRODUCT"|"COMMENT", "text": string } | null }`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: salesEditResponseSchema,
      model: getModelForRole("STANDARD"),
      maxTokens: 1024,
      temperature: 0.2,
    });
    return toUsage(result);
  }

  async evaluatePaidCandidate(input: EvaluatePaidCandidateInput): Promise<StructuredResult<PaidCandidateEvaluationDraft>> {
    const system = `あなたはPaid Candidate Evaluator Agentです。無料note記事を読み、有料商品として
展開する価値があるかを以下6軸で評価してください(0-100)。
problem_depth(問題の深さ)/actionability(行動可能性)/repeat_value(繰り返し参照される価値)/
specificity(具体性)/transformation_value(変化をもたらす価値)/purchase_intent(購入意欲の見込み)

診断・チェックリスト・テンプレート・ワークブック・30日プログラム・具体的手順・意思決定フレームは有料向き。
共感・気づき・問題提起・ストーリー・基本情報は無料向き。
is_paid_candidateは、これらのスコアが総じて高い場合のみtrueにしてください。
出力は指定のJSONスキーマのみ。`;

    const prompt = `# ${input.freeArticleTitle}
中心課題: ${input.coreProblem ?? "(なし)"}

${input.freeArticleBody}

以下のJSONスキーマで出力してください:
{ "problem_depth": number, "actionability": number, "repeat_value": number, "specificity": number, "transformation_value": number, "purchase_intent": number, "is_paid_candidate": boolean, "reasoning": string }`;

    const result = await callClaudeStructured({
      system,
      prompt,
      schema: paidCandidateEvaluationSchema,
      model: getModelForRole("STANDARD"),
      maxTokens: 1024,
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
