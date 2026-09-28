// 手動編集保護(セクション5・21・22)。Threads本文・note Sectionいずれも、
// 人間が一度手動編集したら、以後AIによる再生成・上書きの対象から外れる。

/** manual_edited済みのコンテンツはAIによる再生成の対象にしない。 */
export function canAiRegenerate(manualEdited: boolean): boolean {
  return !manualEdited;
}

/** Threadsのリライトは manual_edited でなく、かつ rewrite_count が上限(2回)未満のときだけ許可する。 */
export function canRewriteThreadsPost(manualEdited: boolean, rewriteCount: number, maxRewrites = 2): boolean {
  return canAiRegenerate(manualEdited) && rewriteCount < maxRewrites;
}
