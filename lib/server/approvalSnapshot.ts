import crypto from "crypto";

/**
 * Approval Snapshot Hash (spec §45, §63-64): a deterministic hash of exactly
 * the fields that must not silently change between CEO approval and the
 * moment an external/high-stakes action actually executes (recipient,
 * subject, body, attachment/version references). A mismatch at
 * execution time means the approval no longer covers what is about to
 * happen — the action must be blocked and re-approval required, never
 * proceed on a "close enough" match.
 */
export function computeSnapshotHash(fields: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(canonicalize(fields)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type SnapshotInvalidReason = "APPROVAL_EXPIRED" | "APPROVAL_INVALIDATED";

export interface SnapshotCheckResult {
  valid: boolean;
  reason?: SnapshotInvalidReason;
}

/**
 * Verifies an approval is still good to act on, right before the gated
 * action executes. A `null` snapshotHash means the call site that created
 * this approval never computed one (every pre-Phase-5 approval type) —
 * that always passes, so this check is purely additive and never regresses
 * an approval type that doesn't use it.
 */
export function checkSnapshot(params: { snapshotHash: string | null; expiresAt: string | null; currentFields: Record<string, unknown> }): SnapshotCheckResult {
  if (params.expiresAt && new Date(params.expiresAt).getTime() < Date.now()) {
    return { valid: false, reason: "APPROVAL_EXPIRED" };
  }
  if (!params.snapshotHash) return { valid: true };
  if (computeSnapshotHash(params.currentFields) !== params.snapshotHash) {
    return { valid: false, reason: "APPROVAL_INVALIDATED" };
  }
  return { valid: true };
}
