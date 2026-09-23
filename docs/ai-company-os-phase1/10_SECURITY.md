# 10 — Security

## 10.1 Threat model addressed by PHASE 1

| Risk | Control |
|---|---|
| Autonomy silently degrading safety under load/outage | Fail-Closed LLM provider selection (§10.2) |
| A human bypassing a policy that should be absolute | Hard DENY, unconditionally override-proof (§10.5) |
| One tenant reading/mutating another tenant's autonomy state | RLS + independent application-layer tenant scoping (§10.3) |
| A retried/duplicated Planner or cron invocation creating duplicate real-world work | Idempotency via a real DB unique constraint (§10.6) |
| Enabling this feature changing behavior for tenants that never opted in | Feature flag defaulting to `false`, checked before any new table is touched (§10.4) |
| An autonomy stage failing without a trace | `writeDecisionLog()` + `transitionCycle`/`transitionWork` on every catch path (`01_ARCHITECTURE.md §1.2` item 7) |
| Unbounded spend/looping | Cost Guardrail (`08_COST_GUARDRAIL.md`) + seven Loop Safety limits on `tenant_autonomy_settings` |

## 10.2 Fail-Closed LLM provider

`lib/ai/llmProvider.ts::getLLMProvider()` has **zero environment-based bypass** — no `NODE_ENV`/test-mode branch anywhere in the function. Mock is permitted only when `autonomyMode ∈ {OFF, SHADOW}`; `ASSISTED`/`ACTIVE` with no configured `ANTHROPIC_API_KEY` throws `LLMProviderUnavailableError` rather than silently falling back to a fabricated Mock answer. Verified in `lib/ai/llmProvider.test.ts`.

## 10.3 Tenant isolation

Two independent layers:

1. **RLS** (`02_SCHEMA.md §2.5`) — every new table has `is_tenant_member(tenant_id)`-scoped policies, the same security-definer function every pre-existing table already uses. Not re-verifiable in this sandbox (no live Postgres — see `11_OPERATIONS.md §11.1`).
2. **Application-layer scoping** — every single query in `lib/autonomy/**` and `lib/server/autonomyCockpit.ts` filters by `tenant_id` (confirmed by a static audit: every module's `.from(...)` call count is matched or exceeded by its `tenant_id` mention count). `lib/autonomy/tenantIsolation.test.ts` (9 tests, added in task #89) independently proves this behaviorally against `FakeSupabase` for every new table: `tenant_autonomy_settings`, `objectives`, `skill_definitions`, `autonomy_cycles`/`objective_observations`, `decision_logs`, `cost_ledgers`/`cost_reservations` (including that `reconcile()`/`release()` refuse a reservation id belonging to a different tenant with `NotFoundError`), `works` (including that two tenants' idempotency keys for an identical input tuple never collide, since the key itself is namespaced by `tenantId`), and the Cockpit's aggregation.

These two layers are independent: RLS would still hold even if an application bug omitted a `tenant_id` filter, and the application-layer tests hold regardless of whether RLS is correctly deployed — neither is "the only thing" preventing cross-tenant access.

## 10.4 Zero behavior change for pre-PHASE-1 tenants

`tenant_autonomy_settings` is purely additive; no existing tenant is backfilled with `feature_enabled=true`. `lib/autonomy/featureDisabledRegression.test.ts` (5 tests, task #89) proves every entry point (`observeObjective`, `planForCycle`, `createAndAuthorizeWork`, `executeWork`) throws `AutonomyStoppedError` **before** writing to any new autonomy table for such a tenant — not just that the top-level call fails, but that zero rows land in `autonomy_cycles`/`objective_observations`/`plan_proposals`/`works`/`verifications`/`impact_assessments`/`cost_reservations`/`execution_costs`/`decision_logs`/`cost_ledgers`. Pre-existing functions (`createObjective`) are confirmed to never touch any of those tables either. The cron route's own coarse filter (`WHERE feature_enabled = true`) means such a tenant is never even iterated by the scheduler.

## 10.5 Hard DENY

See `07_AUTHORITY_APPROVAL.md §7.2` for the mechanism. Security property: the hard-deny check in `authorizeDecision()` runs *before* the `SUPERUSER_ROLES` check, making the bypass unreachable by construction for a hard-denied match — not a permission check that could be misconfigured to allow it, an actual early-return in the function body. `lib/server/approvals.test.ts` covers this by attempting the override as every role including `owner`/`ceo`/`admin`.

## 10.6 Idempotency as a security property

A compromised/misbehaving caller retrying `createAndAuthorizeWork()` for the same `(tenant, objective, observation, skill, cycle)` tuple cannot create two Works, two authority evaluations, or two `approval_requests` rows — the DB's `unique(tenant_id, idempotency_key)` constraint is the real backstop (`02_SCHEMA.md §2.3`), independent of whatever application-level check ran first.

## 10.7 What was NOT re-verified in this sandbox

No live Postgres/Supabase instance is available here, so:

- The three migrations (`02_SCHEMA.md`) have only been validated statically (parenthesis/quote balance, `psql --dry-run` is unavailable) — never run against a real Postgres.
- RLS policies have not been exercised against a real authenticated session; only `is_tenant_member`'s existing, already-proven-correct definition is relied on.

`11_OPERATIONS.md §11.1` covers what a human operator must do to close this gap before the pilot goes live.

## 10.8 Full regression coverage

458/458 tests passing (up from 291 pre-PHASE-1, then 444 through task #88, +14 dedicated security/regression tests in task #89), `npx tsc --noEmit` clean, `npx eslint .` clean (the same 2 pre-existing, unrelated errors in `app/page.tsx`/`components/SavePanel.tsx` that predate this phase and were never touched by it), `npm run build` clean. No pre-existing test file was ever modified by this phase — every new assertion lives in a new file.
