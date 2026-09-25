# PHASE 1.5 — 01. Migration Preflight

**Verdict: PASS.** All 3 migrations apply cleanly, in order, on top of the real 8-migration production schema, with zero structural defects found. Two minor, non-blocking findings are documented below (§7). **No change has been made to any real/production database.** This report was produced by applying the migrations to a disposable, local-only Postgres 16 instance in this sandbox (`p15_preflight`, since dropped — see §8) — the standard verification technique already used by every prior phase in this codebase per their own README sections ("a real local Postgres 16 run of all N migrations in order").

## 1. Method

1. Started the sandbox's local Postgres 16 server (`service postgresql start`) — entirely separate from the real Supabase project; nothing about this touches production.
2. Created a throwaway database (`p15_preflight`), stubbed the two things a bare Postgres lacks that Supabase provides (`auth.users` table, `auth.uid()` function returning `null`) — the minimum needed for the existing RLS policies' `auth.uid()` references to resolve at `CREATE POLICY` time.
3. Applied all **8 pre-existing migrations**, in filename order, with `ON_ERROR_STOP=1` — reproducing the exact real production schema shape before testing anything new.
4. Applied the **3 new PHASE 1.5 migrations** on top, in filename order, with `ON_ERROR_STOP=1`.
5. Queried `information_schema`/`pg_catalog` directly (not just re-reading the SQL) to confirm the actual resulting schema, and ran targeted data tests for the items static review alone can't settle (trigger cascades, constraint semantics).

## 2. Result: all 3 migrations applied without error

```
20260925000000_ai_company_os_phase1_autonomy_core.sql        exit=0
20260926000000_ai_company_os_phase1_cost_ledger.sql          exit=0
20260927000000_ai_company_os_phase1_objective_project_link.sql  exit=0
```

## 3. Migration order

Correct and required: `objective_project_link` (`objectives.project_id`) depends on the `objectives` table created by `autonomy_core`; `cost_ledger` has no FK dependency on `autonomy_core`'s tables but is conceptually part of the same feature. Postgres/Supabase apply migrations in filename-timestamp order (`20260925 < 20260926 < 20260927`), which is exactly right. No reordering needed.

## 4. Foreign keys — live-verified

43 FK constraints exist across the 13 new tables post-migration, every one resolving to an existing table (`tenants`, `auth.users`, `projects`, and the new tables' own cross-references) with matching `uuid` column types throughout — confirmed via `pg_constraint`, not just read from the SQL source. Full list captured in the session log; every new table's `tenant_id` FK targets `public.tenants(id) on delete cascade`, consistent with every existing table in this schema.

## 5. Unique constraints, indexes, triggers, RLS — live-verified

| Check | Result |
|---|---|
| 13 new tables exist | ✅ all 13 present |
| 9 additive columns (6 groups) exist, correct type/nullability | ✅ all present; `approval_policies.hard_deny` correctly `NOT NULL DEFAULT false` |
| RLS enabled | ✅ `relrowsecurity = true` on all 13 new tables |
| Policy count per table | ✅ 2 (append-only) / 3 (system-managed) / 4 (full-lifecycle) per table, matching `02_SCHEMA.md §2.5`'s three patterns exactly |
| Unique constraints | ✅ all 5 documented ones present: `autonomy_cycles(tenant_id,objective_id,cycle_number)`, `skill_definitions(tenant_id,executor_ref)`, `works(tenant_id,idempotency_key)`, `works(tenant_id,observation_id,skill_definition_id)`, `cost_ledgers(tenant_id,ledger_date)` |
| Indexes | ✅ all documented indexes present (30 total across new tables, incl. every named `_idx`) |
| `updated_at` triggers | ✅ all 5 present (`objectives`, `skill_definitions`, `works`, `tenant_autonomy_settings`, `cost_ledgers`) |
| Check-constraint value sets | ✅ all 21 check constraints' allowed values were pulled from `pg_get_constraintdef()` and compared against `lib/autonomy/types.ts`'s TS unions — **identical in every case**, confirming the "mirror the check constraints exactly" contract that file's own doc comment states actually holds |

## 6. Live functional tests

**`handle_new_tenant_for_user()` end-to-end, via a real trigger cascade** — inserted a row into the stubbed `auth.users` (which fires `handle_new_user()` → `public.users` insert → fires `on_user_created_provision_tenant` → `handle_new_tenant_for_user()`, the same chain a real Supabase signup triggers) and confirmed:
- New tenant created, `tenant_autonomy_settings` seeded with `feature_enabled=false, autonomy_mode='OFF', emergency_stop=false` — the safe default.
- Exactly 18 `skill_definitions` rows seeded.
- `work_creation` approval policy seeded (`steps: [{"role":"manager"}]`).
- Total `approval_policies` for the tenant: **10** (9 pre-existing policy codes from Phase 4/5/7 + the 1 new `work_creation`) — confirms nothing from the pre-existing seeding was dropped when `handle_new_tenant_for_user()` was redefined in full.

**Diff against the immediately-prior version of `handle_new_tenant_for_user()`** (Phase 7's) — extracted and diffed both function bodies textually: the only changes are the 3 additive insertions (one appended row to the existing `approval_policies` values list, one new `tenant_autonomy_settings` insert, one new 18-row `skill_definitions` insert). Every single line from the Phase 7 version is preserved verbatim. This was the single highest-risk item in the whole migration (a copy-paste-and-extend error here would silently break tenant provisioning for every future signup, not just the pilot) — confirmed clean.

**Re-run safety** — applied `autonomy_core` a second time against the already-migrated database: failed immediately and cleanly on `relation "objectives" already exists` at the very first statement (nothing partially applied on the second attempt, since it is the file's first statement). Confirms the documented guidance ("do not re-run a migration that has already succeeded") is necessary and that a re-run attempt fails loud, not silent.

## 7. Two minor findings (non-blocking)

1. **`works(tenant_id, observation_id, skill_definition_id)` gives zero protection when `observation_id` is NULL.** Live-tested: inserted two `works` rows with identical `tenant_id`/`skill_definition_id` and `observation_id = NULL` — both succeeded, because Postgres unique constraints treat `NULL` as distinct from `NULL`. **Not a blocker**: `application code (`lib/autonomy/authorityEngine.ts`) always supplies a real `observationId` from an actual `objective_observations` row when creating Works through the real Planner→Authority pipeline — this constraint was always documented as "belt-and-suspenders," and the *actual* enforced backstop, `unique(tenant_id, idempotency_key)` (whose column is `NOT NULL`), was live-tested in the same session and correctly rejected a true duplicate. No code or schema change is proposed for this — noted for awareness only, since a future caller that ever passes a null `observationId` on purpose would not be protected by the secondary constraint.
2. **The migration files are not wrapped in an explicit `BEGIN/COMMIT` block.** Supabase's own CLI (`supabase db push`) wraps each migration file in a transaction automatically, but the Supabase Dashboard's SQL Editor does not, unless the operator adds `BEGIN;`/`COMMIT;` themselves. A mid-migration failure applied via the raw SQL Editor would leave a partially-applied schema (as reproduced in §6's re-run test). **Recommendation for §8's apply instructions**: either use the Supabase CLI, or wrap each file's contents in an explicit transaction when pasting into the SQL Editor.

## 8. Cleanup

The throwaway `p15_preflight` database has been dropped. The local Postgres 16 server itself is left running (harmless, local-only, no cost) in case a later PHASE 1.5 step benefits from the same disposable-DB technique again (e.g. §4's RLS Live Verification could reuse this exact setup before ever touching the real Supabase project) — say if you'd like it stopped.

## 9. Apply instructions for the real Supabase project (STOP — awaiting your approval)

Nothing below has been executed. Present, not run, per PHASE 1.5's STOP rule.

**Recommended: Supabase CLI** (auto-transactional per file, matches how this repo's migrations are meant to be applied):
```
supabase db push
```
This applies every migration under `supabase/migrations/` not yet recorded as applied on the linked project, in filename order — i.e. exactly the 3 new ones, assuming the 8 prior ones are already applied (they should be, since this is the running production schema).

**Alternative: Supabase Dashboard → SQL Editor**, one file at a time, each wrapped in an explicit transaction (per §7 finding 2):
```sql
begin;
-- paste the full contents of 20260925000000_ai_company_os_phase1_autonomy_core.sql
commit;
```
then repeat for `20260926000000_ai_company_os_phase1_cost_ledger.sql`, then `20260927000000_ai_company_os_phase1_objective_project_link.sql` — in that exact order, each as its own transaction, waiting for each to succeed before starting the next.

**Before running either**: take a Supabase point-in-time-recovery/backup snapshot first (standard practice before any production migration, not specific to this one) — this migration needs no rollback script because it is purely additive, but a snapshot costs nothing and is the safety net if anything unexpected happens.

Once you've applied these (by either method) against the real project, tell me and I'll move to **§3 Post-Migration Verification** — the same catalog queries used in §5/§6 above, but run against the real Supabase project via its own SQL Editor/CLI, plus the additive "existing data intact / existing APIs operational / feature-disabled tenant unaffected" checks from the original PHASE 1.5 spec.
