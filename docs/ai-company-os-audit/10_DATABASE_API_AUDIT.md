# 10 — Database & API/Route Audit

Database schema detail (56 tables, full domain mapping) is in `04_DOMAIN_MODEL_AUDIT.md`; this document covers the API/route inventory in full, plus the DB→domain correspondence summary and per-table KEEP/MODIFY/REPLACE/DELETE/MISSING classification is consolidated in `12_KEEP_MODIFY_REPLACE_DELETE.md`.

## 10.1 Shared route infrastructure

- `getTenantContext()` (`lib/server/tenant.ts`) — resolves `tenant_id`/`role` from the session; every non-cron route calls this first.
- `withRoute()` — maps thrown Unauthorized/Forbidden/NotFound/Validation to 401/403/404/400.
- `isCronRequestAuthorized()` — bearer `CRON_SECRET` check for the 4 cron routes (service-role client, no user session).

Total: **52 route.ts files** (48 non-cron + 4 cron), **9 page.tsx files**.

## 10.2 API route inventory (by feature area)

**Leads/Sales**: `leads` (list/create), `leads/[id]/detail` (read), `leads/[id]/start-research` (→`lead_generation_graph`, sync), `leads/[id]/prepare-outreach` (→`sales_outreach_prep_graph`, sync), `sales/discovery-runs` (→`lead_discovery_graph`, sync), `sales/lost-analysis` (read, **no caller found**), `sales-messages/[id]/send` (Final Send Gate, real email + idempotency CAS), `sales-messages/[id]/simulate-reply` (→`reply_analysis_graph`, sync), `do-not-contact`, `icp-profiles`(+`[id]`).

**Opportunities**: `[id]/detail`, `[id]/meetings` (POST →`meeting_scheduling_graph`, sync), `[id]/negotiation-items` (POST →`negotiation_analysis_graph`, sync), `[id]/proposals` (POST →`proposal_draft_graph`, sync), `[id]/won` (→`deal_won_gate_graph`, sync), `[id]/lost`, `[id]/delivery-packages` (create only).

**Proposals/Estimates**: `[id]/generate-file`, `[id]/send` (Delivery Gate), `proposals/[id]/new-version` (**no caller found**), `estimates/[id]/new-version` (**no caller found**).

**Meetings**: `[id]/transcript`, `[id]/prep` (→`meeting_prep_graph`, sync), `[id]/select-time` (real Calendar create), `[id]/minutes` (→`meeting_minutes_graph`, sync), `[id]/minutes/confirm`.

**Meeting Action Items**: `[id]/confirm`, `[id]/reject`, `[id]/convert-to-task`.

**Projects/Delivery**: `[id]/room` (aggregate read), `[id]/measure` (→`measurement_graph`, sync), `[id]/renew` (→`renewal_graph`, sync), `[id]/delivery/confirm` (human delivery), `delivery-packages/[id]/send` (**no caller found**).

**Growth Loop**: `kpis/[id]/manual-value` (**no caller found**), `monthly-reports/[id]` (**no caller found**), `monthly-reports/[id]/deliver` (**no caller found**).

**Files**: `files/download` (the **one unauthenticated route** — signed-token redemption, HMAC-verified), `generated-files/[id]/download` (in-app authenticated), `generated-files/[id]/share-link` (**no caller found** — meaning `files/download`'s only real entry point is itself unreachable from the UI today).

**Integrations/OAuth**: `integrations` (status), `integrations/google/start`, `integrations/google/callback` (real token exchange), `integrations/google/disconnect`.

**Approvals**: `approvals/[id]/decide` — the single shared, heavily-used decision endpoint for every approval type.

**Office**: `office/state` (dashboard aggregate), `agents/[id]/detail` (agent detail aggregate).

## 10.3 Cron routes + scheduling (see `06_EVENT_TRIGGER_SCHEDULER_AUDIT.md` for full detail)

`sla-check`, `followup-check`, `token-refresh`, `growth-loop-check` — all real, all gated by `CRON_SECRET`, all wrapped in a Postgres-lock (`background_jobs`). **No `vercel.json` or other scheduler wiring exists in this repo** — none of the four is currently invoked by anything.

## 10.4 Synchronous-agent-execution-in-HTTP-request — full list

13 route handlers `await runBusinessGraph()` (or, for one, twice in a loop) directly inline before returning their HTTP response, with no queue or background worker:

1. `POST /api/leads/[id]/start-research`
2. `POST /api/leads/[id]/prepare-outreach`
3. `POST /api/sales/discovery-runs`
4. `POST /api/sales-messages/[id]/simulate-reply`
5. `POST /api/opportunities/[id]/meetings`
6. `POST /api/opportunities/[id]/negotiation-items`
7. `POST /api/opportunities/[id]/proposals`
8. `POST /api/opportunities/[id]/won`
9. `POST /api/meetings/[id]/prep`
10. `POST /api/meetings/[id]/minutes`
11. `POST /api/projects/[id]/measure`
12. `POST /api/projects/[id]/renew`
13. `POST /api/cron/growth-loop-check` — **worst case**: loops over every tenant's every matching project, sequentially, inside one HTTP POST; runtime scales linearly with (tenants × projects), no batching or background dispatch.

Additionally, `runBusinessGraph()` self-chains `onboarding_graph → execution_graph` on completion (see `05_AGENT_RUNTIME_AUDIT.md`) — compounding synchronous work beyond what the calling route explicitly requested.

## 10.5 Page route tree

`/` (unrelated AI-search-visibility calculator, client component) · `/login` (server, redirects if authenticated) · `/home`, `/task/today` (unrelated "YATTORU" demo product, server wrappers) · `/webops` (auth-gated, 100% client-scripted demo, touches no tenant table) · `/office` (server, `getOfficeState()`) · `/office/leads/[id]`, `/office/opportunities/[id]`, `/office/projects/[id]` (server, respective aggregate-state loaders, then client polling).

## 10.6 Possible dead/unused routes (no caller found anywhere in components/app)

1. `sales/lost-analysis` (GET)
2. `proposals/[id]/new-version` (POST)
3. `estimates/[id]/new-version` (POST)
4. `delivery-packages/[id]/send` (POST) — UI creates packages but never sends them (incomplete feature, not obsolete)
5. `kpis/[id]/manual-value` (POST) — ProjectRoom shows KPIs read-only; no input form wired
6. `monthly-reports/[id]` (GET) — ProjectRoom lists reports but never links to the detail route
7. `monthly-reports/[id]/deliver` (POST) — no "deliver" button wired
8. `generated-files/[id]/share-link` (POST) — no UI generates a share link (making `files/download` unreachable from the UI in practice)

The 4 cron routes are expected to have no in-app caller (external scheduler only) — but with no scheduler wired at all, they are currently unreachable by *anything*, not just the frontend.

## 10.7 Possible duplicates / overlapping functionality

1. `proposals/[id]/new-version` vs `estimates/[id]/new-version` — a deliberately parallel pair (proposal vs. its priced estimate), both currently uncalled — worth confirming only one "new version" UI flow is planned to cover both.
2. `generated-files/[id]/download` vs `files/download` — intentionally two different security models (in-app authenticated vs. external signed-token), but their response-construction code (content-type map, byte-decoding, headers) is copy-pasted rather than shared.
3. `projects/[id]/measure` (manual) vs `cron/growth-loop-check` (scheduled sweep) — both can trigger the same `measurement_graph` for the same project; functionally overlapping trigger paths, worth confirming the manual route is meant to coexist with the (currently unscheduled) cron sweep rather than being a workaround for the cron never running.
