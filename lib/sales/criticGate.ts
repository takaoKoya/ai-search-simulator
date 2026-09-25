export type CriticVerdict = "PASS" | "REVISION_REQUIRED" | "BLOCKED";

export interface CriticGateDecision {
  verdict: CriticVerdict;
  /** True if the graph should loop back and regenerate instead of forwarding to CEO approval. */
  shouldRetry: boolean;
  nextRevisionCount: number;
}

/**
 * Revision-loop policy (spec §26): up to `maxRevisions` regenerate attempts
 * on a failed Critic review. Once the cap is hit, the loop never continues
 * indefinitely — the item is forwarded to the human (CEO Inbox) flagged as
 * still having open Critic issues, rather than silently blocked or retried
 * forever.
 */
export function decideCriticVerdict(passed: boolean, revisionCount: number, maxRevisions = 3): CriticGateDecision {
  if (passed) {
    return { verdict: "PASS", shouldRetry: false, nextRevisionCount: revisionCount };
  }
  if (revisionCount < maxRevisions) {
    return { verdict: "REVISION_REQUIRED", shouldRetry: true, nextRevisionCount: revisionCount + 1 };
  }
  return { verdict: "REVISION_REQUIRED", shouldRetry: false, nextRevisionCount: revisionCount };
}
