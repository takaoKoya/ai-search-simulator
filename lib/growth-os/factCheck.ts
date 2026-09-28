// Fact Check(セクション13)のアプリ側強制ルール。
// 「AI自身が生成した文章をAI自身が正しいと言うだけ」では確認完了にしないため、
// 数字・日付・制度に類する主張は、Sourceが無い限りアプリ側でUNVERIFIEDへ強制降格する。

import type { FactClaimClassification } from "@/lib/growth-os/types";
import type { SourceEntryInput } from "@/lib/growth-os/ai/types";

const NUMERIC_OR_DATE_PATTERN =
  /(\d+(\.\d+)?\s*(%|パーセント|円|万円|億円|歳|年|ヶ月|か月|人|件|倍))|(\d{4}年)|(令和|平成)\d+年/;

export interface FactClaimEnforcementInput {
  claim: string;
  aiClassification: FactClaimClassification;
  sourceHintIndex: number | null;
}

export interface FactClaimEnforcementResult {
  classification: FactClaimClassification;
  downgraded: boolean;
  downgrade_reason: string | null;
}

/**
 * AIが VERIFIED/SUPPORTED と自己申告していても、
 * 1. 数字・日付・制度らしき表現を含み、かつ
 * 2. source_hint_index が無い(=裏付けを示せていない)
 * 場合は、UNVERIFIEDへ強制的に降格する。OPINION/EXPERIENCEはそもそも事実確認の対象外なのでそのまま通す。
 */
export function enforceFactClaimClassification(input: FactClaimEnforcementInput): FactClaimEnforcementResult {
  const looksFactual = input.aiClassification === "VERIFIED" || input.aiClassification === "SUPPORTED";
  const hasNumericOrDateClaim = NUMERIC_OR_DATE_PATTERN.test(input.claim);
  const hasSource = input.sourceHintIndex !== null && input.sourceHintIndex !== undefined;

  if (looksFactual && hasNumericOrDateClaim && !hasSource) {
    return {
      classification: "UNVERIFIED",
      downgraded: true,
      downgrade_reason:
        "数字・日付・制度に関する主張ですが、裏付けとなるSourceが示されていないためUNVERIFIEDへ降格しました",
    };
  }

  // Sourceが全く無いのにVERIFIED/SUPPORTEDと自己申告している場合も、根拠なしの自己証明とみなし降格する。
  if (looksFactual && !hasSource) {
    return {
      classification: "UNVERIFIED",
      downgraded: true,
      downgrade_reason: "Sourceの裏付けなしにAIが自己申告したVERIFIED/SUPPORTEDのため降格しました",
    };
  }

  return { classification: input.aiClassification, downgraded: false, downgrade_reason: null };
}

/** AIが返す source_hint_index(プロンプトに渡した配列のインデックス)を実際のSource IDへ解決する。 */
export function resolveSourceHint(
  sourceHintIndex: number | null,
  availableSources: SourceEntryInput[]
): string | null {
  if (sourceHintIndex === null || sourceHintIndex === undefined) return null;
  const source = availableSources[sourceHintIndex];
  return source ? source.id : null;
}

/** WAITING_APPROVAL遷移前の警告判定: UNVERIFIEDなclaimが1件でもあれば人間へ警告する(セクション13)。 */
export function hasUnverifiedClaims(classifications: FactClaimClassification[]): boolean {
  return classifications.some((c) => c === "UNVERIFIED");
}
