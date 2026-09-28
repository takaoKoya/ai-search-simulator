import "server-only";

// AIコスト最適化(セクション27)。役割ごとに使うモデルを分離できるようにし、
// モデル名をAgent実装へハードコードしない。Settings(gos_settings key='ai_model_config')で
// 上書きできるよう、呼び出し側は必ず getModelForRole() 経由でモデルIDを取得すること。

export type AgentRole =
  | "LIGHT_CLASSIFY" // Research分類、Fact Claim抽出など軽い分類・抽出作業
  | "STANDARD" // Outline、9軸スコアリングなど標準的な生成・評価
  | "HIGH_QUALITY" // Writer、Critical Editorなど文章品質が結果を左右する工程
  | "BULK_GENERATE"; // Threads 5案など数を出す生成

const DEFAULT_MODEL_BY_ROLE: Record<AgentRole, string> = {
  LIGHT_CLASSIFY: "claude-haiku-4-5",
  STANDARD: "claude-sonnet-5",
  HIGH_QUALITY: "claude-sonnet-5",
  BULK_GENERATE: "claude-sonnet-5",
};

export interface ModelStrategyOverrides {
  LIGHT_CLASSIFY?: string;
  STANDARD?: string;
  HIGH_QUALITY?: string;
  BULK_GENERATE?: string;
}

let overrides: ModelStrategyOverrides = {};

/** Settings画面から読み込んだ上書き設定を適用する(アプリ起動/リクエスト単位で呼ぶ想定)。 */
export function setModelStrategyOverrides(next: ModelStrategyOverrides) {
  overrides = next ?? {};
}

export function getModelForRole(role: AgentRole): string {
  return overrides[role] ?? process.env.GROWTH_OS_CLAUDE_MODEL ?? DEFAULT_MODEL_BY_ROLE[role];
}

export function getDefaultModelByRole(): Record<AgentRole, string> {
  return { ...DEFAULT_MODEL_BY_ROLE };
}
