import type {
  GeneratedIdea,
  IdeaScoreResponse,
  ResearchAnalysis,
  ContentStrategyDraft,
  ThreadsDraft,
  ThreadsScoreResponse,
  OutlineResponse,
  SectionDraft,
  ArticleReviewResponse,
  FactCheckResponse,
  SalesEditResponse,
  PaidCandidateEvaluationDraft,
} from "@/lib/growth-os/ai/schemas";

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
  estimated_cost: number;
  attempts: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: AIUsage;
  raw_text: string;
}

export interface AnalyzeResearchInput {
  title: string;
  summary: string | null;
  rawText: string | null;
  sourceName: string;
  keyword: string | null;
}

export interface ResearchSourceInput {
  title: string;
  summary: string | null;
  surfaceProblem: string | null;
  deepProblem: string | null;
  emotionalTrigger: string | null;
  harmTypes: string[];
}

export interface GenerateIdeasInput {
  sources: ResearchSourceInput[];
  ideaCount?: number; // 既定1。複数Research選択時は2〜3案の生成を許容する。
}

export interface ScoreIdeaInput {
  title: string;
  hook: string | null;
  angle: string | null;
  targetPersona: string | null;
  coreProblem: string | null;
  evidenceSummaries: string[]; // 根拠となったResearchの要約(Confidence算出のsource/evidence件数と対応)
}

// --------------------------------------------------------------
// フェーズ3共通のコンテキスト型
// --------------------------------------------------------------
export interface WritingProfileContext {
  preferredTone: string;
  sentenceLength: string;
  humorLevel: number;
  directness: number;
  emotionalLevel: number;
  technicalLevel: number;
  emojiLevel: number;
  lineBreakStyle: string;
  ngPhrases: string[];
  preferredPhrases: string[];
}

export interface ExperienceEntryInput {
  id: string;
  title: string;
  summary: string;
  tags: string[];
}

export interface SourceEntryInput {
  id: string;
  title: string;
  summary: string | null;
}

export interface StrategyContext {
  targetReader: string;
  mainMessage: string;
  uniqueAngle: string;
  desiredAction: string;
  threadsRole: string;
  freeNoteRole: string;
  paidNoteRole: string | null;
  ctaStrategy: string;
}

export interface GenerateStrategyInput {
  ideaTitle: string;
  hook: string | null;
  angle: string | null;
  targetPersona: string | null;
  coreProblem: string | null;
  harmTypes: string[];
  recommendedFreeOrPaid: string | null;
  evidenceSummaries: string[];
}

export interface GenerateThreadsInput {
  ideaTitle: string;
  strategy: StrategyContext | null;
  experiences: ExperienceEntryInput[];
  writingProfile: WritingProfileContext | null;
}

export interface ScoreThreadsInput {
  body: string;
  patternType: string;
}

export interface RewriteThreadsInput {
  body: string;
  patternType: string;
  scoreFeedback: string;
  experiences: ExperienceEntryInput[];
  writingProfile: WritingProfileContext | null;
}

export interface GenerateOutlineInput {
  ideaTitle: string;
  coreProblem: string | null;
  strategy: StrategyContext;
  articleType: "FREE" | "PAID";
  noteRole: string;
}

export interface DraftSectionInput {
  articleTitle: string;
  strategy: StrategyContext;
  articleType: "FREE" | "PAID";
  heading: string;
  purpose: string | null;
  keyPoints: string[];
  evidenceRequired: boolean;
  experienceRequired: boolean;
  precedingSectionsSummary: string | null;
  availableSources: SourceEntryInput[];
  availableExperiences: ExperienceEntryInput[];
  writingProfile: WritingProfileContext | null;
  /** AI_REVIEWでNEEDS_REVISIONとなった際、Critical Editorのrevision_instructionsをそのまま渡す。 */
  revisionInstructions?: string | null;
}

export interface ReviewArticleInput {
  title: string;
  fullBody: string;
  strategy: StrategyContext;
}

export interface FactCheckInput {
  fullBody: string;
  availableSources: SourceEntryInput[];
}

export interface SalesEditInput {
  title: string;
  fullBody: string;
  articleType: "FREE" | "PAID";
  price: number | null;
  ctaStrategy: string;
}

export interface EvaluatePaidCandidateInput {
  freeArticleTitle: string;
  freeArticleBody: string;
  coreProblem: string | null;
}

/**
 * Claudeへの依存箇所をこのインターフェースの背後に隠す。
 * 将来モデル変更・プロバイダ変更(他社LLM等)する場合はこのメソッド群を実装するだけでよい。
 * UIやRoute Handlerから直接Claudeを呼び出すことは禁止し、必ずこのProvider経由にすること。
 */
export interface AIProvider {
  analyzeResearch(input: AnalyzeResearchInput): Promise<StructuredResult<ResearchAnalysis>>;
  generateIdeas(input: GenerateIdeasInput): Promise<StructuredResult<GeneratedIdea[]>>;
  scoreIdea(input: ScoreIdeaInput): Promise<StructuredResult<IdeaScoreResponse>>;

  generateStrategy(input: GenerateStrategyInput): Promise<StructuredResult<ContentStrategyDraft>>;
  generateThreads(input: GenerateThreadsInput): Promise<StructuredResult<ThreadsDraft[]>>;
  scoreThreads(input: ScoreThreadsInput): Promise<StructuredResult<ThreadsScoreResponse>>;
  rewriteThreads(input: RewriteThreadsInput): Promise<StructuredResult<ThreadsDraft>>;
  generateOutline(input: GenerateOutlineInput): Promise<StructuredResult<OutlineResponse>>;
  draftSection(input: DraftSectionInput): Promise<StructuredResult<SectionDraft>>;
  reviewArticle(input: ReviewArticleInput): Promise<StructuredResult<ArticleReviewResponse>>;
  factCheckArticle(input: FactCheckInput): Promise<StructuredResult<FactCheckResponse>>;
  salesEditArticle(input: SalesEditInput): Promise<StructuredResult<SalesEditResponse>>;
  evaluatePaidCandidate(input: EvaluatePaidCandidateInput): Promise<StructuredResult<PaidCandidateEvaluationDraft>>;
}
