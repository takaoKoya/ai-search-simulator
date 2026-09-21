import type { GeneratedIdea, IdeaScoreResponse, ResearchAnalysis } from "@/lib/growth-os/ai/schemas";

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

/**
 * Claudeへの依存箇所をこのインターフェースの背後に隠す。
 * 将来モデル変更・プロバイダ変更(他社LLM等)する場合はこの3メソッドを実装するだけでよい。
 */
export interface AIProvider {
  analyzeResearch(input: AnalyzeResearchInput): Promise<StructuredResult<ResearchAnalysis>>;
  generateIdeas(input: GenerateIdeasInput): Promise<StructuredResult<GeneratedIdea[]>>;
  scoreIdea(input: ScoreIdeaInput): Promise<StructuredResult<IdeaScoreResponse>>;
}
