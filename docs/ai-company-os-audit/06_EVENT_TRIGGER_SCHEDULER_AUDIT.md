# 06 — Event / Trigger / Scheduler / Queue Audit

Read-only audit of `lib/office/eventTypes.ts`, every `agent_events`-writing call site, all 4 `app/api/cron/**` routes, and a repo-wide search for queue/worker/job infrastructure.

## 6.1 Event taxonomy is cosmetic, not actionable

`lib/office/eventTypes.ts` defines ~60 event-type strings (sales, ops, approval, contract, delivery, growth categories) with only display metadata (label/category/severity/icon) — no dispatch table, no handler registry, no `subscribe()`. **Nothing in the codebase subscribes to an `event_type` and reacts to it.** Every read of `agent_events` (officeState.ts, leadDetail.ts, opportunityDetail.ts, projectRoom.ts, agent detail route) is a plain `.select()+.order()+.limit()` for a UI list. No Supabase Realtime usage exists anywhere in the repo (`postgres_changes`/`.channel(` grep: zero hits). The one process that could be mistaken for event-driven automation — renewal checking anomalies — is a direct `anomaly_events` table read within the same graph execution, not a subscription to an `anomaly.detected` event (that event string is written purely for the activity feed, alongside the real table insert).

**Event-writing is fire-and-forget.** The shared helper `emitEvent()` (`lib/langgraph/context.ts`) does one insert and returns; no insert into `agent_events` ever causes another graph or job to run. The real graph→graph auto-chain that does exist (`onboarding_graph → execution_graph`, see `05_AGENT_RUNTIME_AUDIT.md`) is a direct in-process function call in the orchestrator — the `emitEvent` calls around it are narration, not the trigger.

## 6.2 Cron routes are real; nothing schedules them

Four routes exist under `app/api/cron/**`, gated by a bearer-token check (`isCronRequestAuthorized`) using the service-role Supabase client:

- **`sla-check`** — recomputes `approval_requests.sla_status` (ON_TRACK/DUE_SOON/BREACHED). Label only.
- **`followup-check`** — creates `followup_candidates` for stalled outreach. Never auto-sends.
- **`token-refresh`** — proactively refreshes Google OAuth tokens nearing expiry.
- **`growth-loop-check`** — the most substantial: for every tenant, for every `ready_for_delivery`/`delivered` project, **synchronously invokes `measurement_graph` then `renewal_graph`** via `runBusinessGraph()`, in a nested loop, inside one HTTP request handler.

**No `vercel.json` exists anywhere in this repo** (confirmed by file search). No GitHub Actions workflow, no npm script, and no other in-repo mechanism calls any of these four routes. `README.md` itself instructs a human operator that `growth-loop-check` "should be scheduled hourly-or-slower" — i.e., wiring the actual trigger is documented as a deployment-time task that has not been done in this codebase. **As committed, these are dormant HTTP endpoints, not a running scheduler.**

## 6.3 No queue/worker infrastructure

A repo-wide search for queue/worker/BullMQ/pg-boss/dead-letter/concurrency turned up nothing beyond: UI copy for the human "Manager Approval Queue" (unrelated), a `"queued"` value in a cosmetic agent-status enum, and `idempotency_key` columns (send-idempotency, not job-queue idempotency). No queue technology is a dependency in `package.json`. The only real infrastructure is `background_jobs` — a single-row-per-job-key Postgres mutex (`lib/server/backgroundJob.ts::runBackgroundJob`) that genuinely prevents two overlapping cron ticks from double-running the same job.

**Gap found in that lock**: there is no TTL/stale-lock recovery. If the process crashes mid-run, `locked_at` is never cleared by anything else, so the job would report "already running" forever until a human manually clears the row.

**Per-business-object idempotency, separately, is real**: `measurement_plans`/`reporting_cycles`/`contract_renewals` have terminal-status guards and unique-per-period constraints, so a repeated sweep tick won't double-draft a report or double-create a renewal even before the outer job-lock is considered.

## 6.4 No per-tenant or per-agent schedule configurability

No `schedules`/`recurrence`/`cron_config` table exists anywhere. `background_jobs.job_key` is a plain global text key with no `tenant_id` and no cadence column — there is exactly one global schedule slot per job type (all four jobs loop internally over every tenant), not a configurable "run agent X for tenant Y at time Z." No API route exists for a human to configure such a thing.

## 6.5 Overall assessment

Real, substantive scheduled-automation *logic* exists — especially `growth-loop-check`'s KPI evaluation, anomaly detection, and upsell detection — and it has correct-for-its-scope overlap locking. But: (a) nothing in this repo currently schedules it, (b) events are pure telemetry with zero subscribers, (c) there is no queue/worker system, and (d) there is no tenant/agent-level schedule configurability. Until external scheduler wiring is added (Vercel Cron Jobs dashboard setting, or equivalent), **this system can currently do nothing on a schedule or in response to an event without a human first clicking something.**
