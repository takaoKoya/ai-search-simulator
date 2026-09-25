# PHASE 1.5 — Pre-Production Schema Drift Check

## FINAL DECISION: **UNKNOWN**

Not PASS, not BLOCKED — this session has **no way to reach the real Supabase project at all**, so sections 2–8 below cannot be performed. This is a hard capability limit, not a policy choice, and is reported honestly rather than guessed at, per this check's own §9 rule ("確認できない場合はUNKNOWNとする。推測しない").

**Read-only rule (§1): never at risk of violation.** There is no credential, no linked CLI project, and no database connector available in this session that could reach the real project even for a read — so no write was possible in the first place, let alone attempted. Confirmed by direct inspection (see §0).

## 0. Why this is UNKNOWN, not a refusal

Checked, concretely, before writing this report:

| What I looked for | Result |
|---|---|
| `.env`/`.env.local` with real values | Absent — only `.env.example` (blank template) exists in the repo |
| `supabase/config.toml` (a linked project ref) | Does not exist — this repo has never been `supabase link`-ed in an environment I have access to |
| Supabase CLI (`supabase` binary) | Not installed in this sandbox |
| A Supabase MCP connector/tool | Not present in this session's toolset (checked via tool search — zero matches) |
| Outbound network reachability to `*.supabase.co`/`supabase.com` | This sandbox's egress proxy allowlist (`no_proxy`/`NO_PROXY`) does not include any Supabase domain — even a raw `curl` to a Supabase REST endpoint would be blocked at the network layer, independent of credentials |

Every one of the checks in §2–§8 requires an authenticated, live connection to your specific Supabase project. None of those five things exists here. What I *can* do — and did, for §1's Migration Preflight — is reproduce your 8 existing migrations on a disposable local Postgres and compare against that. That is a **local reproduction of what the migrations declare**, not a look at **what your real project actually has right now**. Those are two different facts, and this check specifically asked for the second one, which I cannot obtain from inside this sandbox as currently configured.

## 1. What "MATCH / DRIFT / UNKNOWN" therefore evaluates to

Every yes/no judgment call requested in §2–§8 of your spec: **UNKNOWN**, not by default-to-pass or default-to-fail, but because zero data exists to judge with.

## 2. Two ways to actually close this out

**Option A — you run the read-only query kit below yourself.** Every query is `SELECT`-only (no `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER`/`DROP`/function-replace/policy-change anywhere), safe to run in the Supabase Dashboard's SQL Editor or via `psql`/CLI against your real project. Paste the results back here and I will do the actual drift comparison against the exact local baseline captured in §3 below (from `01_MIGRATION_PREFLIGHT.md`'s local reproduction) and issue a real PASS/BLOCKED verdict.

**Option B — grant this session read-only access** (e.g. attach a Supabase connector if one is available on your account, or provide the project's URL + a **read-only** Postgres role's credentials as environment variables — never the `service_role` key for this purpose, since that bypasses RLS entirely and is far more access than a read-only schema check needs). I would then run the same queries myself and report back.

I'd recommend **Option A** for a Production database — it keeps your credentials out of this session entirely, which is the safer default for a one-time read-only check.

## 3. Read-only query kit

### §2 — Migration History

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

**Expected (MATCH) if your 8 existing migrations are exactly what's applied:**
```
20260722000000  init_schema
20260913000000  ai_company_os_phase1
20260915000000  ai_sales_department_phase3
20260917000000  ai_sales_execution_phase4
20260919000000  production_sales_ops_phase5
20260921000000  approval_snapshot_invalidation
20260922000000  file_security_and_delivery
20260924000000  growth_loop_phase7
```
Anything extra → **unexpected/manually-applied migration**, flag it. Anything missing → **missing migration**, flag it (would itself block PHASE 1.5, since the 3 new migrations assume all 8 are already applied). The 3 PHASE 1.5 migrations (`20260925…`/`20260926…`/`20260927…`) should **not** appear yet — their presence here would mean someone already applied them outside this conversation.

### §3 — Existing Schema Drift (the tables PHASE 1.5 will touch)

```sql
-- Columns, types, nullability, defaults
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name in ('kpis','tasks','workflow_runs','agent_events','approval_requests',
  'approval_policies','tenants','users','background_jobs','projects','clients',
  'kpi_snapshots','contract_renewals','memberships')
order by table_name, ordinal_position;

-- PK/FK/unique/check constraints
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid::regclass::text in ('kpis','tasks','workflow_runs','agent_events','approval_requests',
  'approval_policies','tenants','users','background_jobs','projects','clients',
  'kpi_snapshots','contract_renewals','memberships')
order by table_name, contype, conname;

-- Indexes
select tablename, indexname, indexdef from pg_indexes
where tablename in ('kpis','tasks','workflow_runs','agent_events','approval_requests',
  'approval_policies','tenants','users','background_jobs','projects','clients',
  'kpi_snapshots','contract_renewals','memberships')
order by tablename, indexname;

-- Triggers
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_table in ('kpis','tasks','workflow_runs','agent_events','approval_requests',
  'approval_policies','tenants','users','background_jobs','projects','clients',
  'kpi_snapshots','contract_renewals','memberships')
group by 1,2,3,4 order by 1,2;
```

**Compare against the local baseline reproduction** (`01_MIGRATION_PREFLIGHT.md §5`, and the RLS/policy facts pulled fresh for this check — §5 below). If the real project's structure for these 14 tables differs from what the 8 migration files declare, that is DRIFT and must be resolved (reconciling migration history, or identifying the manual change) before any new migration runs — a migration written against an assumed baseline that doesn't match reality is exactly the scenario this check exists to catch.

### §4 — Critical Function: `handle_new_tenant_for_user()`

```sql
select pg_get_functiondef('public.handle_new_tenant_for_user()'::regprocedure);
```

Compare the returned function body **textually** against the one defined in `supabase/migrations/20260924000000_growth_loop_phase7.sql` (lines 412–533 in the repo) — that is the version that *should* currently be live, since PHASE 1.5's migration (which redefines this function again) has not been applied yet. Any difference here — extra logic, a missing insert, different literal values — is either a manual hotfix that was never captured as a migration file, or a migration-history drift, and is an automatic **STOP** per your own rule §4. Do not attempt to reconcile it yourself; report the exact diff.

### §5 — Approval Policies (real data)

```sql
select tenant_id, code, description, conditions, steps, is_active
from public.approval_policies order by tenant_id, code;

select code, count(*) as tenant_count from public.approval_policies group by code order by code;
```

**Expected baseline** (per-tenant, from `handle_new_tenant_for_user()`): exactly these 9 codes per tenant — `sales_send`, `estimate_amount_low`, `estimate_amount_high`, `discount_low`, `discount_high`, `deal_won`, `delivery`, `monthly_report`, `upsell_opportunity`. A 10th code, `work_creation`, must **not** exist yet (it's created by the PHASE 1.5 migration, not yet applied). Any tenant missing one of the 9, any tenant with extra/different codes, or any `conditions`/`steps` value that doesn't match the literal values in the migration files, is tenant-specific drift — flag it, do not modify it.

### §6 — Existing Data Compatibility

By construction, every column PHASE 1.5 adds to an existing table is either nullable (`kpis.objective_id`, `tasks.work_id`/`cycle_id`, `workflow_runs.cycle_id`, `agent_events.cycle_id`, `approval_requests.cycle_id`) or has a `DEFAULT` that back-fills every existing row (`approval_policies.hard_deny boolean not null default false`), and the one narrowing-adjacent change (`kpis.project_id` losing its `NOT NULL`) is a *loosening*, which cannot reject an existing row. So the analytically expected conflict count is **0** for every existing table. Still worth a live sanity check, since "analytically 0" and "actually 0" should agree:

```sql
-- Row counts, to confirm these tables aren't empty (a genuinely empty
-- production table would make this whole section moot but is itself
-- worth knowing before a pilot).
select 'kpis' as t, count(*) from public.kpis
union all select 'tasks', count(*) from public.tasks
union all select 'approval_policies', count(*) from public.approval_policies
union all select 'workflow_runs', count(*) from public.workflow_runs
union all select 'agent_events', count(*) from public.agent_events
union all select 'approval_requests', count(*) from public.approval_requests;

-- The only even theoretically tightening change: confirm no existing
-- approval_policies row already uses the literal string 'hard_deny' in
-- a way that would collide (it wouldn't — this is a new column, not a
-- new check on an existing one — included for completeness/paranoia only).
select count(*) from public.approval_policies where conditions ? 'hard_deny' or steps::text ilike '%hard_deny%';
```
Expected: last query returns 0. Any non-zero result across this section is a genuine, unexpected finding — **migration prohibited** per your rule §6 until explained.

### §7 — New Object Collision

```sql
-- 13 new tables — expect 0 rows (none should exist yet)
select table_name from information_schema.tables where table_schema='public' and table_name in (
 'objectives','autonomy_cycles','objective_observations','skill_definitions',
 'plan_proposals','works','verifications','impact_assessments','cost_reservations',
 'execution_costs','decision_logs','tenant_autonomy_settings','cost_ledgers');

-- New constraint/index names — expect 0 rows
select conname from pg_constraint where conname in (
 'autonomy_cycles_tenant_id_objective_id_cycle_number_key',
 'skill_definitions_tenant_id_executor_ref_key',
 'works_tenant_id_idempotency_key_key',
 'works_tenant_id_observation_id_skill_definition_id_key',
 'cost_ledgers_tenant_id_ledger_date_key');
select indexname from pg_indexes where schemaname='public' and indexname in (
 'objectives_status_idx','autonomy_cycles_objective_idx','objective_observations_cycle_idx',
 'skill_definitions_department_idx','plan_proposals_cycle_idx','works_objective_idx','works_cycle_idx',
 'verifications_work_idx','impact_assessments_work_idx','cost_reservations_tenant_day_idx',
 'execution_costs_tenant_idx','decision_logs_cycle_idx');

-- New trigger names — expect 0 rows
select tgname from pg_trigger where tgname in (
 'objectives_set_updated_at','skill_definitions_set_updated_at','works_set_updated_at',
 'tenant_autonomy_settings_set_updated_at','cost_ledgers_set_updated_at') and not tgisinternal;

-- New additive columns on EXISTING tables — expect 0 rows (would mean
-- someone already hand-added one of these ahead of the migration)
select table_name, column_name from information_schema.columns where
  (table_name='kpis' and column_name='objective_id') or
  (table_name='tasks' and column_name in ('work_id','cycle_id')) or
  (table_name='workflow_runs' and column_name='cycle_id') or
  (table_name='agent_events' and column_name='cycle_id') or
  (table_name='approval_requests' and column_name='cycle_id') or
  (table_name='approval_policies' and column_name='hard_deny');
```
Any non-empty result here is a real collision (most likely a manual prototype attempt) and blocks the migration until reconciled — **do not** let the migration run as-is against a project with a pre-existing same-named object; the `CREATE TABLE`/`ALTER TABLE ADD COLUMN` statements are not guarded with `IF NOT EXISTS`, so they would either fail loudly (safe, if a definition differs) or — worse — silently coexist with incompatible manual data (unsafe, if a prototype table exists with the same name but a different shape). This must be resolved as a **STOP**, not worked around.

### §8 — RLS Baseline (existing tables)

```sql
select relname, relrowsecurity from pg_class
where relname in ('kpis','tasks','workflow_runs','agent_events','approval_requests',
  'approval_policies','tenants','users','background_jobs','projects','clients',
  'kpi_snapshots','contract_renewals','memberships')
order by relname;

select tablename, policyname, cmd from pg_policies
where tablename in ('kpis','tasks','workflow_runs','agent_events','approval_requests',
  'approval_policies','tenants','users','background_jobs','projects','clients',
  'kpi_snapshots','contract_renewals','memberships')
order by tablename, policyname;
```

**Local baseline to diff against** (freshly reproduced for this check, same disposable-Postgres method as `01_MIGRATION_PREFLIGHT.md`, all 8 migrations applied, nothing from PHASE 1.5):

| Table | RLS | Policies (name — command) |
|---|---|---|
| `tenants` | on | `tenants_select_member` — SELECT |
| `memberships` | on | `memberships_select_own_tenant` — SELECT |
| `users` (public) | on | `users_select_own` — SELECT, `users_update_own` — UPDATE |
| `projects` | on | `projects_{select,insert,update}_member`, `projects_delete_admin` (4) |
| `clients` | on | `clients_{select,insert,update}_member`, `clients_delete_admin` (4) |
| `kpis` | on | `kpis_{select,insert,update}_member`, `kpis_delete_admin` (4) |
| `kpi_snapshots` | on | `kpi_snapshots_{select,insert,update}_member`, `kpi_snapshots_delete_admin` (4) |
| `tasks` | on | `tasks_{select,insert,update}_member`, `tasks_delete_admin` (4) |
| `workflow_runs` | on | `workflow_runs_{select,insert,update}_member`, `workflow_runs_delete_admin` (4) |
| `agent_events` | on | `agent_events_{select,insert,update}_member`, `agent_events_delete_admin` (4) |
| `approval_requests` | on | `approval_requests_select_member`, `approval_requests_insert_member`, `approval_requests_decide_admin` (3) |
| `approval_policies` | on | `approval_policies_{select,insert,update}_member`, `approval_policies_delete_admin` (4) |
| `contract_renewals` | on | `contract_renewals_{select,insert,update}_member`, `contract_renewals_delete_admin` (4) |
| `background_jobs` | on | **0 policies** — intentional; only the service-role client (which bypasses RLS) ever touches this table |

Any extra policy on these tables in the real project that isn't in this list is **Production-specific and must be reported, not removed or modified** — per your rule §8, this check only observes.

## 4. §9 Backup/Recovery Readiness and §10 Environment Confirmation — also UNKNOWN, and cannot be turned into read-only SQL

These two are Supabase **Dashboard** facts, not database facts — no SQL query reveals your project's PITR/backup configuration or which environment (prod/staging/dev) a given project actually is; that's project metadata, not schema. Please check and report back directly (no secrets needed):

- **§9**: Dashboard → Database → Backups — is Point-in-Time Recovery enabled, and what's the most recent backup timestamp? If you don't know, that itself is the honest **UNKNOWN** answer per your own rule — I will not guess a "yes."
- **§10**: Dashboard → Project Settings → General — the Project Name and Project Reference (safe to share; it's an identifier, not a secret) tell us definitively which project this is. Please also confirm in your own words whether this is the Production tenant database — I have no way to infer that from anything available here.

## 5. Status

**Nothing has been read from or written to any real database.** §12/§13 of your spec don't apply yet — there is no PASS to act on and no concrete drift to report a fix for, only an access gap. Once you've either run §3's queries and pasted the results, or confirmed §4's environment facts, I'll produce the actual MATCH/DRIFT verdict per table and the Final Decision (PASS/BLOCKED) this check is meant to end with.
