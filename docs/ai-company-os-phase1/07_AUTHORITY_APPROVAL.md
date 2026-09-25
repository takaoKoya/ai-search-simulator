# 07 — Authority & Approval

`lib/autonomy/authorityEngine.ts` — the only component allowed to set `works.authority_decision`. A Work is never "just created"; `createAndAuthorizeWork()` creates and authority-evaluates it in the same flow, the two are never separated.

## 7.1 `evaluateAuthority()` — pure, confidence-blind

```ts
interface AuthorityEvaluationInput {
  skillApprovalPolicyCode: string | null;
  estimatedCost: number;
  policies: ApprovalPolicyRow[];
}
```

No `confidence` field anywhere in this type — see `05_PLANNER.md §5.3`; this is spec FINAL CHANGE 6 made structural, not conventional.

| Condition | Decision |
|---|---|
| Skill has no `approval_policy_code` | `AUTO` — nothing gates it |
| Policy code set, but no matching `approval_policies` row (`selectApprovalPolicy`, same matcher every other approval type already uses) | `APPROVAL` — an unresolvable policy must never silently default to auto-execution |
| Matching policy has `hard_deny = true` | `DENY` |
| Matching policy has `steps.length === 0` | `AUTO` |
| Matching policy has one or more steps | `APPROVAL` |

`STATUS_BY_DECISION` maps `AUTO → APPROVED`, `APPROVAL → AUTHORITY_PENDING`, `DENY → DENIED` — the Work's status transition (via `transitionWork()`, `04_STATE_MACHINE.md`) that follows immediately.

## 7.2 Hard DENY — unconditionally override-proof

`approval_policies.hard_deny` (additive column, default `false`) is checked in `lib/server/approvals.ts::authorizeDecision()` **before** the existing `SUPERUSER_ROLES` (`owner`/`ceo`/`admin`) bypass — not merely alongside it:

```ts
function authorizeDecision(ctx, steps, currentStep, action, hardDeny) {
  if (hardDeny && action === "approve") {
    throw new ForbiddenError("This approval is Hard DENY per policy — no role, including owner/ceo/admin, may approve it.");
  }
  if (SUPERUSER_ROLES.includes(ctx.role)) return;   // unreachable above for a hard_deny match
  ...
}
```

Because the hard-deny check is the *first* statement, the superuser bypass is structurally unreachable for a hard-denied policy match, for every role including `owner`. `isHardDenyPolicyMatch()` looks this up from `approval_policies.hard_deny` for the request's `policy_code`. There is no flag anywhere a human can flip back on a hard-denied Work — a hard DENY closes that Work permanently (`DENIED` is terminal, `04_STATE_MACHINE.md §4.3`); only a new Work (new idempotency key, e.g. a new cycle/observation) can retry the underlying goal.

`authorityEngine.test.ts` proves this by attempting an override as every role including `owner`/`ceo`/`admin` and asserting all fail identically.

## 7.3 Idempotency (real DB constraint, not app-only)

`computeWorkIdempotencyKey({ tenantId, objectiveId, observationId, skillDefinitionId, cycleId })` — a deterministic FNV-1a hash (`02_SCHEMA.md §2.3`), so a retried/duplicated Work-creation attempt for the same tuple always yields the same key. `createAndAuthorizeWork()`'s pre-check (`findExistingWorkByIdempotencyKey`) is a fast, deterministic *application-level* path — the real enforcement is the DB's `unique(tenant_id, idempotency_key)` constraint, which `FakeSupabase` cannot simulate (it does not raise unique-violation errors), so the pre-check is also the only path the test suite can directly exercise. A duplicate call returns the existing Work's id/status/authority (`duplicate: true`) rather than erroring.

## 7.4 Approval reuse (`type = 'work_creation'`)

`AUTHORITY_PENDING` Works reuse the existing `approval_requests`/`decideApproval()` mechanism unchanged — no new approval subsystem. `createAndAuthorizeWork()` inserts an `approval_requests` row (`type: "work_creation"`, `subject_type: "work"`, `steps` from the matched policy, `cycle_id` set) only for the `APPROVAL` branch; a `hard_deny` match never reaches this insert at all (there is nothing to ask a human about — the answer is already, unconditionally, no). A human decides it exactly like every other approval type, through the same `/api/approvals/[id]/decide` route; `applyApproval`/`applyNonApproval`'s `work_creation` branch calls `transitionWork(..., "APPROVED"/"DENIED")`.

PHASE 1 does not trigger execution synchronously from `decideApproval()` — the next `objective-observer` cron tick's sweep of `APPROVED` Works (`03_AUTONOMY_RUNTIME.md §3.1`) is what actually runs `advanceApprovedWork()` for a human-approved Work, the same loosely-coupled "cron sweeps for actionable rows" pattern the existing `growth-loop-check` route already uses.

## 7.5 AssigneeResolver

`lib/autonomy/assigneeResolver.ts::resolveAssignee()` — PHASE 1 unconditionally returns `{ assigneeType: "SYSTEM", assigneeRef: "SYSTEM_ASSIGNEE" }`. Exists as its own function/interface boundary (rather than an inlined constant in the Execution Adapter) so a later `AI_EMPLOYEE` routing branch is a pure addition to this one function, never a rewrite of the Execution Adapter's contract.
