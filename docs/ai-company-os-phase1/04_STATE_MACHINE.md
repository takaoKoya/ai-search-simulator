# 04 — State Machine

## 4.1 The one rule

No module in `lib/autonomy/**` writes `autonomy_cycles.status` or `works.status` directly. Every transition goes through `lib/autonomy/stateTransition.ts::transitionCycle()`/`transitionWork()`, which:

1. Reads the row's current status (tenant-scoped).
2. Looks it up in the whitelist (`CYCLE_TRANSITIONS`/`WORK_TRANSITIONS`, `lib/autonomy/types.ts`).
3. Throws `IllegalStateTransitionError` (a `ValidationError` subclass) if the target status isn't in that status's allowed-next list.
4. Otherwise writes the new status (plus `outcome`/`ended_at` for cycles).

## 4.2 Cycle transitions

```ts
CYCLE_TRANSITIONS = {
  RUNNING:   ["COMPLETED", "FAILED", "ESCALATED"],
  COMPLETED: [],
  FAILED:    [],
  ESCALATED: [],
}
```

All three non-`RUNNING` statuses are terminal — an empty array, not a documented convention. Resuming means a *new* `autonomy_cycles` row (next `cycle_number`, chained via `parent_cycle_id`), never reopening a closed one. `WAIT`/`BLOCK` Supervisor decisions make **no** cycle transition at all — the cycle simply stays `RUNNING` until something external resolves it (a human decision, an in-flight execution finishing); this is consistent with "no implicit reopen," since a `RUNNING` cycle was never closed in the first place.

## 4.3 Work transitions

```ts
WORK_TRANSITIONS = {
  PROPOSED:          ["AUTHORITY_PENDING", "APPROVED", "DENIED"],
  AUTHORITY_PENDING: ["APPROVED", "DENIED"],
  APPROVED:          ["EXECUTING", "CANCELLED"],
  EXECUTING:         ["COMPLETED", "FAILED", "BLOCKED"],
  DENIED:            [],
  COMPLETED:         [],
  FAILED:            [],
  BLOCKED:           [],
  CANCELLED:         [],
}
```

Five of the nine statuses are terminal. Note `APPROVED → CANCELLED` is the one non-obvious edge: Shadow Mode's Execution Adapter uses it (an `APPROVED` Work in `SHADOW` mode is recorded but deliberately never executed — `CANCELLED` is the closest existing terminal meaning "this will not run," without implying failure).

## 4.4 Supervisor decision table (`lib/autonomy/supervisor.ts::reviewCycleOutcome`)

A pure function, unit-tested exhaustively per branch (`supervisor.test.ts`). Evaluated in this order:

| # | Condition | Decision |
|---|---|---|
| 1 | `planDecision === REPLAN` and `replanCount >= max_replans_per_cycle` | `ESCALATE` |
| 2 | `planDecision === null` (no `plan_proposals` row for this cycle) | `ESCALATE` |
| 3 | `planDecision === ESCALATE` | `ESCALATE` |
| 4 | `planDecision === REPLAN` (under the limit) | `WAIT` |
| 5 | `planDecision ∈ {NO_ACTION, WAIT}` | `COMPLETE` |
| 6 | `planDecision === CREATE_WORK` and no Work rows exist | `ESCALATE` |
| 7 | any Work is `PROPOSED`/`AUTHORITY_PENDING`/`EXECUTING` | `WAIT` |
| 8 | any Work is `BLOCKED` | `BLOCK` |
| 9 | any Work is `FAILED` | `ESCALATE` |
| 10 | every Work is `DENIED`/`CANCELLED` | `COMPLETE` |
| 11 | any Verification is `FAIL`/`ESCALATE` | `ESCALATE` |
| 12 | any Verification is `RETRY` | `WAIT` |
| 13 | objective status is `AT_RISK`/`DRAFT` | `NEXT_CYCLE` |
| 14 | otherwise (objective is healthy after a verified execution) | `COMPLETE` |

`COMPLETE`/`NEXT_CYCLE` → `transitionCycle(..., "COMPLETED")`; `ESCALATE` → `transitionCycle(..., "ESCALATED")`; `WAIT`/`BLOCK` → no transition (§4.2).

## 4.5 Illegal-transition error

`IllegalStateTransitionError extends ValidationError` — a caller passing an out-of-whitelist target gets a clear, typed 400-class error (via the existing `withRoute()`/error-mapping convention), never a silent no-op or an unchecked DB write.
