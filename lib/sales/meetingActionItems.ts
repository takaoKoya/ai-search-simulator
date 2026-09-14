/**
 * Meeting Action Item extraction + duplicate detection (spec §21-26).
 *
 * Deliberately simple and deterministic — the same "never guess" discipline
 * as TemplateProvider's budget/timing/decision-maker regexes elsewhere: a
 * sentence only becomes a Candidate when the transcript itself contains an
 * explicit action-cue phrase, and this never invents an owner or due date
 * that wasn't stated (those stay null — a human fills them in when they
 * Confirm). This is a suggestion list for a human to review, never a
 * committed schedule.
 */

const ACTION_CUE_KEYWORDS = ["対応する", "送付する", "共有する", "確認する", "準備する", "提出する", "作成する", "までに", "次回までに", "宿題"];

export interface ActionItemCandidate {
  description: string;
}

export function extractActionItemCandidates(transcript: string): ActionItemCandidate[] {
  const sentences = transcript
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const candidates: ActionItemCandidate[] = [];
  for (const sentence of sentences) {
    if (seen.has(sentence)) continue;
    if (ACTION_CUE_KEYWORDS.some((keyword) => sentence.includes(keyword))) {
      seen.add(sentence);
      candidates.push({ description: sentence });
    }
  }
  return candidates.slice(0, 10);
}

/**
 * Possible-duplicate surfacing (spec §26): never auto-deletes or auto-merges
 * based on similarity — only flags a match for a human to see on the
 * candidate itself. Matching is normalized substring/equality, not
 * embeddings (no such model call exists anywhere in this codebase).
 */
export function findPossibleDuplicate(candidateDescription: string, existing: Array<{ id: string; description: string }>): string | null {
  const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const normalizedCandidate = normalize(candidateDescription);
  if (!normalizedCandidate) return null;

  const match = existing.find((item) => {
    const normalizedExisting = normalize(item.description);
    if (!normalizedExisting) return false;
    return normalizedExisting === normalizedCandidate || normalizedExisting.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedExisting);
  });
  return match?.id ?? null;
}
