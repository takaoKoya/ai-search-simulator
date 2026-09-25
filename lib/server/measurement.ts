/**
 * Deterministic Measurement / Effect Evaluation rules (Growth Loop spec
 * §17-22, §26). Pure, unit-testable functions — the LLM only narrates around
 * these results (spec §20 "LLMだけで成功判定しない"), it never decides
 * SUCCESS/FAILURE itself.
 */

export type KpiDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | "TARGET_RANGE" | "BOOLEAN";

export interface ChangeResult {
  absoluteChange: number | null;
  /** null whenever baseline is 0 or either value is missing — never Infinity (spec §18). */
  percentageChange: number | null;
  hasBaseline: boolean;
}

/** Before/After computation (spec §17-18): baseline=0 never produces a % change, only an absolute one. */
export function computeChange(baseline: number | null, current: number | null): ChangeResult {
  if (baseline == null || current == null) {
    return { absoluteChange: null, percentageChange: null, hasBaseline: baseline != null };
  }
  const absoluteChange = current - baseline;
  const percentageChange = baseline === 0 ? null : absoluteChange / baseline;
  return { absoluteChange, percentageChange, hasBaseline: true };
}

export interface TargetGapResult {
  targetGap: number | null;
  /** 0-1, null when target is missing or 0. */
  achievementRatio: number | null;
}

export function computeTargetGap(current: number | null, target: number | null): TargetGapResult {
  if (current == null || target == null) return { targetGap: null, achievementRatio: null };
  return { targetGap: target - current, achievementRatio: target === 0 ? null : current / target };
}

export type KpiStatus = "ON_TARGET" | "NEAR_TARGET" | "OFF_TARGET" | "CRITICAL" | "NO_DATA";

/** KPI Status classification (spec §40) — direction-aware, threshold-driven, never LLM-judged. */
export function classifyKpiStatus(params: {
  current: number | null;
  target: number | null;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  direction: KpiDirection;
}): KpiStatus {
  const { current, target, warningThreshold, criticalThreshold, direction } = params;
  if (current == null) return "NO_DATA";
  if (direction === "BOOLEAN") return current > 0 ? "ON_TARGET" : "OFF_TARGET";

  const better = (a: number, b: number) => (direction === "LOWER_IS_BETTER" ? a <= b : a >= b);

  if (criticalThreshold != null && !better(current, criticalThreshold)) return "CRITICAL";
  if (target != null && better(current, target)) return "ON_TARGET";
  if (warningThreshold != null && !better(current, warningThreshold)) return "OFF_TARGET";
  if (target != null) {
    const { achievementRatio } = computeTargetGap(current, target);
    if (achievementRatio != null) {
      const ratio = direction === "LOWER_IS_BETTER" ? (current === 0 ? 1 : target / current) : achievementRatio;
      return ratio >= 0.8 ? "NEAR_TARGET" : "OFF_TARGET";
    }
  }
  return "NEAR_TARGET";
}

export type EffectEvaluation =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "NO_SIGNIFICANT_CHANGE"
  | "NEGATIVE"
  | "INCONCLUSIVE"
  | "INSUFFICIENT_DATA";

export type EffectConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface EffectEvaluationInput {
  baseline: number | null;
  current: number | null;
  target: number | null;
  direction: KpiDirection;
  /** True once minimum_data_requirement (sample size / days elapsed) is satisfied. */
  hasSufficientData: boolean;
  dataQuality: "GOOD" | "WARNING" | "POOR" | "UNKNOWN";
  /** True when another change (campaign, release, algorithm update, ...) overlaps the window — caps confidence (spec §21-23). */
  hasConfoundingFactor?: boolean;
}

export interface EffectEvaluationResult {
  evaluation: EffectEvaluation;
  confidence: EffectConfidence | null;
  change: ChangeResult;
  targetGap: TargetGapResult;
}

/** Meaningful-change floor: below this, a move is noise rather than a real effect (no target to compare against). */
const SIGNIFICANT_CHANGE_THRESHOLD = 0.05;

/**
 * Effect Evaluation rule (spec §19-23). Deterministic: SUCCESS/PARTIAL_SUCCESS
 * require an improving direction AND (target achieved fully or partially);
 * NEGATIVE requires the value to have moved the wrong way meaningfully;
 * everything else falls back to NO_SIGNIFICANT_CHANGE/INCONCLUSIVE.
 * INSUFFICIENT_DATA short-circuits everything else — never guess past it.
 */
export function evaluateEffect(input: EffectEvaluationInput): EffectEvaluationResult {
  const change = computeChange(input.baseline, input.current);
  const targetGap = computeTargetGap(input.current, input.target);

  if (!input.hasSufficientData || input.current == null || input.baseline == null) {
    return { evaluation: "INSUFFICIENT_DATA", confidence: null, change, targetGap };
  }

  const improved = input.direction === "LOWER_IS_BETTER" ? input.current < input.baseline : input.current > input.baseline;
  const worsened = input.direction === "LOWER_IS_BETTER" ? input.current > input.baseline : input.current < input.baseline;
  const magnitude = change.percentageChange != null ? Math.abs(change.percentageChange) : change.absoluteChange != null && input.baseline !== 0 ? undefined : 0;
  const isMeaningfulMove = change.percentageChange != null ? magnitude! >= SIGNIFICANT_CHANGE_THRESHOLD : (change.absoluteChange ?? 0) !== 0;

  let evaluation: EffectEvaluation;
  if (input.dataQuality === "POOR") {
    evaluation = "INCONCLUSIVE";
  } else if (improved && isMeaningfulMove) {
    const achieved = targetGap.achievementRatio;
    if (achieved != null && ((input.direction === "LOWER_IS_BETTER" && input.current! <= (input.target ?? -Infinity)) || (input.direction !== "LOWER_IS_BETTER" && achieved >= 1))) {
      evaluation = "SUCCESS";
    } else if (input.target != null) {
      evaluation = "PARTIAL_SUCCESS";
    } else {
      evaluation = "PARTIAL_SUCCESS";
    }
  } else if (worsened && isMeaningfulMove) {
    evaluation = "NEGATIVE";
  } else {
    evaluation = "NO_SIGNIFICANT_CHANGE";
  }

  // Confidence (spec §21): data quality sets the starting level, a
  // confounding factor then downgrades it by exactly one step — never the
  // AI's own certainty.
  const CONFIDENCE_RANK: EffectConfidence[] = ["HIGH", "MEDIUM", "LOW"];
  let confidence: EffectConfidence = input.dataQuality === "POOR" ? "LOW" : input.dataQuality === "GOOD" ? "HIGH" : "MEDIUM";
  if (input.hasConfoundingFactor) {
    const nextIndex = Math.min(CONFIDENCE_RANK.indexOf(confidence) + 1, CONFIDENCE_RANK.length - 1);
    confidence = CONFIDENCE_RANK[nextIndex];
  }

  return { evaluation, confidence, change, targetGap };
}

export type AnomalySeverity = "INFO" | "WARNING" | "HIGH" | "CRITICAL";

/**
 * Anomaly Detection (spec §26-29): a plain threshold on the percentage move
 * against baseline — deliberately not ML (spec §26 "高度MLを初期から入れない").
 * Direction-aware: a move is only anomalous when it's a move in the BAD
 * direction for this KPI.
 */
export function detectAnomaly(params: { baseline: number | null; current: number | null; direction: KpiDirection }): AnomalySeverity | null {
  const { baseline, current, direction } = params;
  if (baseline == null || current == null || baseline === 0) return null;

  const pctChange = (current - baseline) / baseline;
  const badMove = direction === "LOWER_IS_BETTER" ? pctChange > 0 : pctChange < 0;
  if (!badMove) return null;

  const magnitude = Math.abs(pctChange);
  if (magnitude >= 0.4) return "CRITICAL";
  if (magnitude >= 0.25) return "HIGH";
  if (magnitude >= 0.15) return "WARNING";
  if (magnitude >= 0.1) return "INFO";
  return null;
}

export type InitiativeType = "seo" | "content" | "cro" | "ads" | "other";

/** Measurement Trigger delay (spec §4) — days after delivery before evaluation may start. */
export function resolveMeasurementStartDelayDays(initiativeType: InitiativeType | null | undefined): number {
  switch (initiativeType) {
    case "seo":
      return 14;
    case "content":
      return 28;
    case "cro":
      return 28;
    case "ads":
      return 7;
    default:
      return 14;
  }
}
