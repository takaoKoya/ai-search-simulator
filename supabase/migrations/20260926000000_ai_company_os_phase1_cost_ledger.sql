-- AI Company OS PHASE 1: Cost Reservation ledger (spec CHANGE 4 / §9)
--
-- A single per-tenant-per-day row that lib/autonomy/costGuardrail.ts uses as
-- the atomic contention point for the ESTIMATE -> RESERVE -> EXECUTE ->
-- ACTUAL -> RECONCILE/RELEASE cost model. Reservation *detail* already lives
-- in `cost_reservations` (one row per attempt, from the prior migration);
-- this table is only the running daily total that a concurrent reserve()
-- call must serialize against. No new locking primitive is introduced: the
-- guardrail reads a row, then performs a conditional UPDATE whose WHERE
-- clause repeats the just-read totals — Postgres's own per-row UPDATE lock
-- makes that conditional update atomic, so of two concurrent reserve() calls
-- racing to update the same ledger row, only the one that observes the
-- still-current totals succeeds; the other's WHERE clause matches zero rows
-- and the guardrail retries with a fresh read.
create table public.cost_ledgers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  ledger_date date not null,
  reserved_total_usd numeric not null default 0,
  reconciled_total_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, ledger_date)
);

create trigger cost_ledgers_set_updated_at before update on public.cost_ledgers
  for each row execute function public.set_updated_at();

alter table public.cost_ledgers enable row level security;

create policy "cost_ledgers_select_member" on public.cost_ledgers
  for select using (public.is_tenant_member(tenant_id));
create policy "cost_ledgers_insert_member" on public.cost_ledgers
  for insert with check (public.is_tenant_member(tenant_id));
create policy "cost_ledgers_update_member" on public.cost_ledgers
  for update using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
