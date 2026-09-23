# 11 — Operations

## 11.1 Applying the migrations (required before any of this runs)

This implementation was built and tested entirely against `FakeSupabase` (`lib/testing/fakeSupabase.ts`) — **no live Postgres/Supabase instance was available during development**, so the three PHASE 1 migrations have only been validated statically (balanced parens/quotes, manual review), never executed. Before enabling PHASE 1 for any real tenant, a human operator must apply them, in order, via the Supabase SQL Editor (or the CLI, matching whatever process every prior phase's migrations already used in this project):

1. `supabase/migrations/20260925000000_ai_company_os_phase1_autonomy_core.sql`
2. `supabase/migrations/20260926000000_ai_company_os_phase1_cost_ledger.sql`
3. `supabase/migrations/20260927000000_ai_company_os_phase1_objective_project_link.sql`

All three are additive-only (`02_SCHEMA.md`) — no existing data is modified beyond the stated backfills (a default-disabled `tenant_autonomy_settings` row, a `work_creation` approval policy, and 18 `skill_definitions` rows per existing tenant). Re-running them is expected to be idempotent for the backfill statements (`where not exists (...)` guards) but table-creation statements are not `if not exists`-guarded — do not re-run a migration that has already succeeded.

## 11.2 Required configuration

| Env var | Required when | Notes |
|---|---|---|
| `CRON_SECRET` | Always (shared with every other `/api/cron/*` route) | Bearer token the scheduler must present |
| `ANTHROPIC_API_KEY` | Any tenant set to `ASSISTED`/`ACTIVE` | Fail-Closed — omitting it makes those modes throw rather than silently degrade (`05_PLANNER.md §5.4`) |

`vercel.json` already schedules `objective-observer` hourly (`0 * * * *`) alongside the four pre-existing cron routes — no additional deployment configuration needed once the app is deployed to Vercel (or wherever the existing cron routes are already scheduled from, if not Vercel).

## 11.3 Enabling a pilot tenant

1. As `owner`/`ceo`/`admin`, `POST /api/autonomy/settings` (or a direct DB update while the Cockpit UI is pilot-only) to set `tenant_autonomy_settings.feature_enabled = true` for the pilot tenant.
2. Start in `autonomy_mode = 'SHADOW'` — every stage runs and is fully traceable, but the Execution Adapter never actually calls `runBusinessGraph()` (`03_AUTONOMY_RUNTIME.md §3.7`). Confirm via `/office/autonomy` (the Pilot Cockpit) and the Activity Feed that Observe→Plan→Authorize decisions look correct for at least one real Objective/KPI before proceeding.
3. Create or link a company `objectives` row with `project_id` set to a real project (required for `measurement_graph`/`renewal_graph` to have anything to operate on — `06_SKILL_REGISTRY.md §6.3`), and an objective-scoped `kpis` row.
4. Promote to `ASSISTED` once Shadow output looks correct — this requires `ANTHROPIC_API_KEY` to be configured (§11.2). Every `AUTO`-decision Work still executes automatically in `ASSISTED`; only `APPROVAL`-decision Works wait on a human via the existing approval flow.
5. `ACTIVE` removes no additional gate beyond what `approval_policies` already governs — Autonomy Mode does not itself bypass Authority (`03_AUTONOMY_RUNTIME.md §3.7`).

## 11.4 Emergency Stop (Kill Switch)

A single toggle, immediately effective without a deploy: `POST /api/autonomy/settings { emergencyStop: true }` (restricted to `owner`/`ceo`/`admin`, same as every other tenant-wide safety control), or the "Emergency Stop" button in the Pilot Cockpit (`/office/autonomy`). Effective the moment the row is updated — every stage's `assertNotStopped()` call reads it fresh on its next invocation. **Stated limitation**: this stops *new* work from starting; it cannot forcibly cancel a `runBusinessGraph()` call already in flight (this codebase has no infrastructure to cancel an in-flight async call server-side) — see `killSwitch.ts`'s own doc comment. This is why the pilot should start in Shadow Mode, where nothing ever executes at all.

## 11.5 Monitoring

- **Activity Feed** (existing AI Office UI) surfaces every `autonomy.*`/`objective.*`/`plan.*`/`work.*`/`execution.*`/`verification.*`/`kpi.autonomy_updated`/`supervisor.*` event (14 new `event_type`s, `lib/office/eventTypes.ts`, category `"autonomy"`).
- **Pilot Cockpit** (`/office/autonomy`) — per-objective KPI/cycle/plan/work/verification/impact/supervisor-decision/pending-approval snapshot, plus tenant-wide cost-today and the Emergency Stop toggle. Read-only projection (`03_AUTONOMY_RUNTIME.md`, `01_ARCHITECTURE.md §1.2` item 2) — never a second state store.
- **`decision_logs`** is the durable audit trail for "why" a decision was made, queryable per cycle/objective/work; `agent_events` remains the raw event stream. Both are tagged with `cycle_id` for cross-referencing.
- A tenant appearing in `autonomy.cron_fired` events but never in `autonomy.cycle_started` for several ticks in a row usually means every objective is hitting `COOLDOWN`/`MAX_CYCLES_REACHED` or has no `ACTIVE`/`AT_RISK` objective — not a failure, just nothing to do that tick.

## 11.6 Rollback

Setting `feature_enabled = false` for a tenant is a complete, immediate rollback to pre-PHASE-1 behavior for that tenant — every entry point Fail-Closes before touching any new table (`10_SECURITY.md §10.4`), and the cron route's own tenant filter stops iterating that tenant entirely. No data is deleted; `autonomy_cycles`/`works`/etc. rows already created remain as a historical record, readable from the Cockpit, but nothing new is written. There is no migration-level rollback path defined (schema is purely additive, so there is nothing destructive to undo) — reverting the code deploy alone is sufficient if a full rollback of PHASE 1's application code is ever needed, since the migration's new tables/columns are inert without the application code that reads/writes them.
