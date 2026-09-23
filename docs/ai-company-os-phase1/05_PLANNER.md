# 05 — Planner

`lib/autonomy/planner.ts::planForCycle()` — judgment and proposal only. The Planner never creates Work, never executes a Skill, never sends a communication, never decides an approval; those all happen downstream of `AuthorityEngine`.

## 5.1 Input contract (`PlannerInput`, `lib/autonomy/types.ts`)

Deliberately bounded — explicitly **never** passed: full conversation history, another tenant's data, or raw chain-of-thought from a prior cycle (only that cycle's `reasoning_summary` values travel forward, via `relevantDecisionSummaries`, capped at 5).

```ts
interface PlannerInput {
  objective: ObjectiveSnapshot;
  kpiSnapshot: KpiSnapshotForPlanner;
  observation: { id, progress, expectedProgress, gap, riskLevel, requiresPlanning };
  existingActiveWorks: WorkSummary[];       // non-terminal Works for this objective, last 20
  recentCompletedWorks: WorkSummary[];
  recentFailedWorks: WorkSummary[];         // FAILED or BLOCKED
  candidateSkills: SkillDefinitionSummary[]; // from SkillCandidateResolver, never the full Registry
  budgetState: { remainingDailyUsd: null; remainingPerCycleUsd: null }; // not wired to a live remaining balance — see §5.6
  authorityConstraints: { maxWorksPerCycle, autonomyMode };
  autonomyMode;
  relevantDecisionSummaries: string[];      // last 5 decision_logs.reasoning_summary for this objective
}
```

## 5.2 Output contract (`PlanProposalSchema`, Zod-validated)

```ts
{
  decision: "NO_ACTION" | "CREATE_WORK" | "REPLAN" | "ESCALATE" | "WAIT",
  reasoningSummary: string,           // required, non-empty
  reasonCodes: string[],
  proposedWorks: ProposedWork[],      // .refine(): must be empty unless decision === "CREATE_WORK"
  expectedImpact?: string,
  candidateSkillIds: string[] (uuid),
  estimatedCost: number,
  confidence: number (0-1),           // ADVISORY ONLY — see §5.3
  recommendedNextObservationAt: string (ISO datetime),
  plannerSuggestedRequiresApproval: boolean, // ADVISORY ONLY — see §5.3
}
```

`ProposedWork` requires a `skillDefinitionId` (validated as a UUID, so a Mock/LLM response must reference a real candidate skill's id, not a name).

## 5.3 Confidence exclusion (spec FINAL CHANGE 6)

`AuthorityEvaluationInput` (`lib/autonomy/authorityEngine.ts`) has no `confidence` field at all — a structural guarantee, verified in `authorityEngine.test.ts`, that `evaluateAuthority()` cannot read Planner confidence under any code path, present or future. `confidence` and `plannerSuggestedRequiresApproval` are stored on `plan_proposals` for audit/analytics only (e.g. "the Planner thought this was safe but policy required approval anyway" is itself a useful signal for a human reviewer).

## 5.4 LLM Provider selection — Fail-Closed (`lib/ai/llmProvider.ts`)

```
mockAllowed = autonomyMode ∈ {OFF, SHADOW}
apiKey = options.apiKeyOverride ?? process.env.ANTHROPIC_API_KEY
apiKey present?                        → AnthropicLLMProvider (kind REAL), regardless of mode
apiKey absent, mockAllowed = false?    → throw LLMProviderUnavailableError  (ASSISTED/ACTIVE with no key)
apiKey absent, mockAllowed = true?     → MockLLMProvider(options.mockRespond), or throw if no mockRespond given
```

**There is no environment-based bypass anywhere in this function** — no `NODE_ENV` check, no test-mode flag. The `mockAllowed` check runs first and is derived from `autonomyMode` alone. `ASSISTED`/`ACTIVE` with no configured key throws before any LLM call is attempted; the Planner's `catch` block transitions the cycle to `FAILED` (or `ESCALATED` for a cost denial — see below) and writes a `decision_logs` row naming exactly why, rather than silently degrading to a fabricated Mock answer.

`lib/ai/anthropicLLMProvider.ts` classifies failures into typed errors (`LLMTimeoutError`, `LLMRateLimitError`, `LLMServerError`, `LLMNetworkError`, `LLMMalformedResponseError`, `LLMSchemaValidationError`) via raw `fetch` to the Anthropic Messages API (no new SDK dependency — same `fetch`-based pattern as the existing Gmail/Calendar connectors), reusing the existing `fetchWithRetry` helper and an `AbortController` timeout.

## 5.5 Deterministic Mock (OFF/SHADOW)

`MockLLMProvider` (`lib/ai/llmProvider.ts`) is a plain scriptable shell — it takes a `respond: (prompt, system) => unknown` function and validates whatever that function returns against the schema. It is **not** a generic schema-filler. The Planner supplies its own rule-based closure, `buildDeterministicMockRespond(input)` (`lib/autonomy/planner.ts`), which inspects the already-built `PlannerInput` (never re-parses the prompt text) and returns one of four deterministic outcomes:

| Condition | Decision |
|---|---|
| `!observation.requiresPlanning` | `NO_ACTION` |
| active Works already exist for this objective | `WAIT` |
| no enabled candidate skills available | `ESCALATE` |
| otherwise | `CREATE_WORK` against `candidateSkills[0]`, priority derived from `observation.riskLevel` |

This is what makes the required 2-Cycle Vertical Slice test genuinely deterministic without a real LLM call (`09_VERTICAL_SLICE.md`).

## 5.6 Cost Guardrail wiring

Before any `REAL`-provider call (never for `MOCK`, which costs nothing): `costGuardrail.reserve()` with a flat `ESTIMATED_PLANNER_LLM_COST_USD = 0.05` placeholder (real per-token/per-model costing is a PHASE 2 concern — this constant exists only to exercise the ESTIMATE/RESERVE/RECONCILE mechanics end-to-end, per spec FINAL requirement §18: "Cost Guardrail must run before any Real LLM call"). A denial (`{allowed:false}`) throws `CostReservationDeniedError`, caught by `planForCycle()`'s own `catch` and routed to `ESCALATED` (distinct from a generic `FAILED`) — see `08_COST_GUARDRAIL.md`. `PlannerInput.budgetState` itself is left `null`/`null` rather than echoing the tenant's total limit back as a misleading "remaining" figure — a live remaining-balance computation is not wired into the Planner's own input in PHASE 1.

## 5.7 Failure handling

Any exception inside `planForCycle()`'s try block (LLM error, schema validation failure, cost denial):

1. Any outstanding cost reservation is released (best-effort — errors here are swallowed since the cycle is already failing for a different reason).
2. `transitionCycle(..., isCostDenial ? "ESCALATED" : "FAILED", { outcome: message })`.
3. A `decision_logs` row with `actor_type: "SYSTEM"` (not `"AI"` — a Planner *failure* is a system-level event, distinct from a completed `"AI"`-actor Planner decision) and the specific reason code.
4. Rethrows — `cycleRunner.ts` catches this only to continue its sweep of other objectives, never to hide that it happened.
