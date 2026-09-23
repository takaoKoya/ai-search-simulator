// 重複テーマ検出(セクション12)。
// V1では文字bigramのJaccard類似度による軽量な判定を行うが、将来Embeddingベースの
// コサイン類似度に差し替えられるよう、判定ロジックは SimilarityDetector インターフェースの
// 背後に隠す。

export interface IdeaSimilarityCandidate {
  id: string;
  title: string;
  hook: string | null;
  coreProblem: string | null;
  targetPersona: string | null;
}

export interface SimilarityDetector {
  /** 0(完全に異なる)〜1(ほぼ同一)の類似度を返す。 */
  computeSimilarity(a: IdeaSimilarityCandidate, b: IdeaSimilarityCandidate): number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/** 日本語は分かち書きされていないため、単語トークンではなく文字bigramで類似度を取る。 */
function bigrams(text: string): Set<string> {
  const normalized = normalize(text);
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    grams.add(normalized.slice(i, i + 2));
  }
  if (grams.size === 0 && normalized.length > 0) {
    grams.add(normalized);
  }
  return grams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function candidateText(candidate: IdeaSimilarityCandidate): string {
  return [candidate.title, candidate.hook, candidate.coreProblem, candidate.targetPersona]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" ");
}

/** V1のデフォルト実装。title/hook/core_problem/target_persona を連結したテキストのbigram類似度。 */
export class LexicalSimilarityDetector implements SimilarityDetector {
  computeSimilarity(a: IdeaSimilarityCandidate, b: IdeaSimilarityCandidate): number {
    return jaccardSimilarity(bigrams(candidateText(a)), bigrams(candidateText(b)));
  }
}

/** この値以上を「類似Ideaあり」として扱う。 */
export const DUPLICATE_SCORE_THRESHOLD = 0.5;

export interface SimilarIdeaMatch {
  idea: IdeaSimilarityCandidate;
  score: number;
}

/** 既存Ideaの中から最も類似度の高いものを1件返す(閾値未満でもスコアは返す)。 */
export function findMostSimilarIdea(
  candidate: IdeaSimilarityCandidate,
  existing: IdeaSimilarityCandidate[],
  detector: SimilarityDetector = new LexicalSimilarityDetector()
): SimilarIdeaMatch | null {
  let best: SimilarIdeaMatch | null = null;
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    const score = detector.computeSimilarity(candidate, other);
    if (!best || score > best.score) {
      best = { idea: other, score };
    }
  }
  return best;
}

export function isDuplicate(score: number): boolean {
  return score >= DUPLICATE_SCORE_THRESHOLD;
}
