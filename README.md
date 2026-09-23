This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## AI Company OS — Phase 1

This repository also hosts a second product, independent of the AI検索対策シミュレーター (`/`)
and YATTORU (`/home`, `/task/today`) apps above: an **AI Company Operating System** at
**`/office`** — an "AI Office" where AI employees (Agents) discover leads, research
companies, draft sales proposals, get reviewed by a Critic, wait for CEO approval, and
carry a won deal through contract review, project/team/task formation, execution, QA,
and delivery. See `supabase/ER.md` for the full schema/RLS writeup.

### Setup

1. Apply `supabase/migrations/20260913000000_ai_company_os_phase1.sql` (in addition to
   the existing `20260722000000_init_schema.sql`) to your Supabase project.
2. Set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` as usual (see
   `.env.example`) — no new secrets or service-role keys are required.
3. Sign up a user (existing Google/Apple/magic-link auth). A Postgres trigger
   (`handle_new_tenant_for_user`) automatically provisions that user's own `tenants` row
   (role `owner`), 4 starter departments, and a 14-agent roster — multi-tenant from the
   first login, no seed script to run.
4. Visit `/office`.

### Architecture

- **Multi-tenant Postgres schema**: `tenants`/`memberships` plus `departments`, `agents`,
  `clients`/`leads`/`opportunities`/`contracts`, `projects`/`goals`/`kpis`/
  `project_team_members`/`tasks`/`deliverables`, a single shared `approval_requests` +
  `decision_memories` table (not separate approval systems per domain), and
  `workflow_runs`/`agent_runs`/`agent_events`/`tool_calls`. Every table carries
  `tenant_id` and is protected by RLS via `is_tenant_member()`/`has_tenant_role()`;
  `tenant_id` is only ever resolved server-side from the authenticated session's
  membership (`lib/server/tenant.ts`), never trusted from a request.
- **AI Provider Adapter** (`lib/ai/provider.ts`): Phase 1 ships only a deterministic,
  local `TemplateProvider` — no outbound network calls, no API keys. This is the
  intentional seam for wiring in OpenAI/Claude/Gemini later via `agents.provider` /
  `agents.model`; when that happens, any externally-fetched content (scraped pages,
  inbound replies) must be treated as `UNTRUSTED_CONTENT` and never as instructions to
  an agent.
- **LangGraph.js orchestration** (`lib/langgraph/`): `lead_generation_graph`,
  `sales_graph`, `contract_graph`, `onboarding_graph`, `execution_graph`,
  `delivery_graph`, `measurement_graph`, `renewal_graph`, run through a
  `runBusinessGraph` BusinessOrchestrator (`lib/langgraph/orchestrator.ts`) that persists
  `workflow_runs` and chains phases (onboarding → execution automatically; a sales/
  contract approval starts the next graph). Checkpointing is a custom
  `SupabaseCheckpointSaver` (`lib/langgraph/checkpointer.ts`) implementing LangGraph's
  `BaseCheckpointSaver` against `workflow_checkpoints`/`workflow_checkpoint_writes`
  instead of in-memory storage, so a graph mid-run survives a server restart
  (`resumeBusinessGraph`). Human-approval boundaries are deliberately **not** modeled as
  a paused LangGraph `interrupt()` — each phase is its own graph/workflow_run, and the
  approval decision route explicitly starts the next one. This keeps "wait days for a
  human" a plain `approval_requests.status = 'pending'` row rather than a long-lived
  in-process suspension.
- **AI Office UI** (`components/office/`): every status, progress bar, activity feed
  entry, and timeline card is read from `agents`/`agent_runs`/`agent_events`/
  `workflow_runs`/`tasks` — nothing is randomly generated. Desktop/tablet uses the
  Header/LeftNav/Office/ActivityFeed/Timeline layout from the design brief; mobile
  switches to a vertical tab UI (社員一覧/稼働中/承認待ち/Activity) instead of shrinking
  the desktop board.

### AI Office UI/UX (Phase 2)

Phase 2 took the same Phase 1 data (agents/workflow_runs/agent_events/tasks/
approval_requests/departments/projects) and raised the AI Office from a functional
board to something that reads as "AI employees actually working here":

- **Design tokens** (`app/globals.css` `.ai-office` block): dark-navy palette, status
  colors, and motion all live as CSS custom properties, not scattered hex codes.
  Per-status motion (`lib/office/status.ts`) is small on purpose and fully disabled
  under `prefers-reduced-motion`.
- **Department Rooms** (`components/office/DepartmentRoom.tsx`): each department is a
  collapsible "room" with real header stats — active/total agents, active projects,
  pending approvals, warnings — computed in `lib/server/officeState.ts` from
  `agent_department_assignments`, `approval_requests.requested_by_agent_id`, and task
  status, not hardcoded department names.
- **Event coverage** (`lib/office/eventTypes.ts`): every event type from the spec
  (workflow.*, critic.reviewed, task.started/completed/blocked, qa.started/failed,
  contract.reviewed/risk_detected, lead.researched/scored, approval.revision_requested,
  …) is both emitted by the graphs (`lib/langgraph/graphs/*`, `lib/langgraph/orchestrator.ts`)
  and categorized (営業/実務/承認/契約/納品/Warning/Error) for the Activity Feed's filter
  tabs and click-through to the relevant agent/approval.
- **CEO Seat/Inbox**: per-type pending counts plus a "today's approvals ≈ N min"
  estimate computed from this tenant's own historical `created_at`→`decided_at` gaps
  (falls back to no estimate when there's no history — never a guessed constant).
  Inbox cards carry a real urgency tier (risk + how long it's been pending), the
  resolved company/project name and deal amount, and Edit-and-Approve (the edit note is
  saved as a `decision_memory`; Phase 2 does not yet rewrite the underlying draft from
  it). Reject/Revise require a reason, enforced server-side in `lib/server/approvals.ts`.
- **Agent Drawer tabs** (Overview/Activity/Evidence/Tools/Technical): Technical is
  gated to owner/ceo/admin. Evidence renders `findings` rows or a visibly distinct
  "no evidence" state; no fabricated confidence score is shown since there's no real
  calculation for one yet.
- **Project Room** (`/office/projects/[id]`, `lib/server/projectRoom.ts`): a
  single-project view with a lifecycle stepper, team, tasks, findings, approvals,
  deliverables, a project-scoped Timeline, and a Delivery Gate
  (Execution Complete / Critic Passed / QA Passed / CEO Approved) computed from actual
  task/deliverable/approval rows — e.g. QA Passed requires every task to have its own
  approved-or-delivered deliverable, not just "some deliverable exists."
- **Realtime**: no Supabase Realtime `postgres_changes` subscriptions were added.
  Broadcasting those tables by default does not enforce RLS unless Realtime-specific
  policies are configured and verified against the live project, which this sandbox
  cannot do — enabling it blind risked leaking one tenant's events to another. The
  Office instead polls `/api/office/state` (`/api/projects/[id]/room` for Project Room)
  every few seconds and shows a small "Realtime disconnected" indicator with automatic
  retry on fetch failure. Revisit Realtime once Realtime RLS is confirmed on the target
  project.
- **Loading/Empty/Error**: no whole-screen spinners — the Agent Drawer shows a
  skeleton and a distinct error state (with the underlying message) instead of hanging
  forever if its detail fetch fails; `/office` and everything under it has a route-level
  error boundary (`app/office/error.tsx`) so a client exception doesn't blank the app.

### Known limitations

- CEO Inbox's Edit-and-Approve saves the CEO's note as a decision_memory but does not
  yet rewrite the AI-drafted content itself before sending it further into the
  pipeline.
- No live Supabase project was available in the development sandbox, so the
  authenticated browser flow (login → create Lead → approve → Delivered) is verified
  through automated tests against a fake Supabase client
  (`lib/langgraph/fullFlow.integration.test.ts` runs the entire pipeline end-to-end) plus
  a real local Postgres run of the migration (schema, RLS, tenant isolation, IDOR — see
  `supabase/ER.md`), not a real browser session. Re-verify against a real project before
  shipping.
- CSRF relies on the default `SameSite` cookie behavior from `@supabase/ssr`; no explicit
  CSRF token is implemented for the new API routes.
- `measurement_graph` / `renewal_graph` exist and run (manually triggered from a
  project's card), but are not part of the tested Phase 1 golden path.

### AI Sales Department — Lead Discovery & Sales Intelligence (Phase 3)

Phase 3 adds an AI-driven Lead Discovery & Sales Intelligence pipeline: AI agents
autonomously discover, research, score, and prepare sales candidates end-to-end, stopping
at CEO approval and a non-sent sales draft. **No outreach is ever sent** — there is no
email/DM/form-submission code path anywhere in this phase; the pipeline's terminal state
is `READY_FOR_OUTREACH` plus a `sales_drafts` row a human must copy out and send manually.

#### Setup

1. Apply `supabase/migrations/20260915000000_ai_sales_department_phase3.sql` (after the
   Phase 1 migration). It backfills a default ICP profile and `scorer`/`writer` agents
   for existing tenants, so no re-signup is needed.
2. Visit `/office`, open **Leads**, and use "Discoveryを開始" with a labeled test fixture
   (A/B/C) — see §81 of the product brief: one candidate is proven end-to-end before any
   batch discovery is attempted. Real market data is not available in this sandbox (no
   search/directory API key), so fixtures are the only discovery source today.

#### Architecture

- **No real external search/directory API is wired in** (`lib/sales/candidateSource.ts`):
  building an unattributed scraper would risk exactly what the brief prohibits (ToS
  violations, robots.txt disregard, CAPTCHA/login bypass). `ManualCandidateSource` (a
  human-typed company) and `TestFixtureCandidateSource` (three fixtures, always flagged
  `testMode: true`) are the only sources. A real, ToS-compliant search/directory API is a
  documented Phase 4 follow-up.
- **`lead_discovery_graph`** (`lib/langgraph/graphs/leadDiscovery.ts`): load ICP → generate
  search strategy → candidate discovery → normalize + create lead → duplicate/exclusion
  check → basic research → website check (simulated, `simulated: true` always present,
  never a real fetch) → lead scoring → if HOT/WARM: deep research → sales hypothesis →
  Critic review (capped at 3 retries via `lib/sales/criticGate.ts`) → CEO approval
  request; if NURTURE/LOW: archived/on-hold, never reaching a human. CEO approval chains
  directly into **`sales_draft_graph`**, which generates and Critic-reviews a
  `sales_drafts` row (channel/subject/body) and stops at `DRAFT_READY` — again, never
  sent.
- **Deterministic Lead Scoring** (`lib/sales/scoring.ts`): 7 weighted axes (ICP Fit,
  Business Potential, Web Problem Severity, Timing Signal, Service Fit, Contactability,
  Confidence) summing to a configurable 100, each with a human-readable reason — no LLM
  "vibes," fully reproducible from the same inputs (`computeLeadScore` is a pure
  function). Weights and HOT/WARM/NURTURE/LOW thresholds are per-tenant, editable in the
  ICP settings panel.
- **Company normalization & duplicate detection** (`lib/sales/normalize.ts`,
  `lib/sales/duplicates.ts`): domain is the strong dedup key; a name-only match without a
  domain match is surfaced as `POSSIBLE_DUPLICATE` for a human to confirm rather than
  silently merged. `checkDuplicate` takes an `excludeLeadId` so a candidate's own
  just-inserted lead row is never mistaken for a pre-existing duplicate of itself (a real
  bug caught by `lib/langgraph/graphs/leadDiscovery.integration.test.ts` during this
  phase's own testing and fixed the same session).
- **Do Not Contact** (`lib/sales/dnc.ts`, `do_not_contact` table): checked before any
  research/AI cost is spent on a candidate; CEO's "Do Not Contact" decision on a
  `sales_lead` approval writes to this list automatically.
- **Decision Learning** (`lib/server/approvals.ts` `maybeFlagRuleCandidate`): scans recent
  sales_lead reject/do-not-contact decisions for a repeated industry pattern and flags the
  matching `decision_memory` as a `rule_candidate` plus a
  `decision.rule_candidate_detected` event — it never rewrites ICP targeting rules
  itself, only surfaces the suggestion for a human.
- **Price honesty**: `salesHypothesis()` always returns `priceRecommendation: null` since
  no real service price table exists yet in this tenant's schema — the AI is never
  allowed to fabricate one.
- **Consolidated schema** (see `supabase/ER.md` for the full writeup): company research,
  growth signals, and the (simulated) website diagnosis all reuse the existing `findings`
  table rather than new narrow tables; a Sales Discovery Run reuses `workflow_runs`
  (its budget/counters live in the existing `state` jsonb column); `icp_profiles` merges
  the brief's "Sales Target Profile" and "ICP" concepts into one table; duplicate-check
  verdicts live directly on `leads` (`duplicate_status`/`duplicate_of_lead_id`) instead of
  a separate table.
- **CEO decisions on a `sales_lead` approval**: Approve, Edit and Approve, Reject/Request
  Revision, Hold, and Do Not Contact — all five wired end-to-end in `CeoInbox.tsx`, the
  Lead Detail page's Approvals tab, and `lib/server/approvals.ts` (`hold`/`do_not_contact`
  are validated as sales_lead-only actions server-side).
- **Lead Detail** (`/office/leads/[id]`, `lib/server/leadDetail.ts`): 9 tabs — Overview,
  Research, Website Analysis, Score (full per-axis breakdown), Sales Strategy, Evidence,
  Activity, Approvals, History (workflow runs + Decision Memory).
- **ICP / Do Not Contact settings** (`components/office/SalesSettingsPanel.tsx`): edits
  ICP targeting fields plus score weights/qualification thresholds (as JSON — the scoring
  engine itself normalizes/validates them at read time) and lets a human register a
  Do Not Contact entry directly.
- **Cost tracking**: every AI-consuming stage of both graphs adds a nominal simulated cost
  to `leads.ai_cost_yen` (`lib/sales/cost.ts`) — a real number that accumulates
  consistently today, ready to swap for real token-based billing once a billed provider
  is wired in.

#### Tests

`lib/sales/scoring.test.ts`, `lib/sales/duplicates.test.ts`, `lib/sales/criticGate.test.ts`
unit-test normalization, hard exclusion, the scoring engine, duplicate detection (including
the self-match regression above), and the revision-loop cap in isolation.
`lib/langgraph/graphs/leadDiscovery.integration.test.ts` runs the full vertical slice
against the fake in-memory Supabase for all three §61 seed scenarios: a qualifying
candidate through to CEO approval and a `DRAFT_READY` draft, a Do Not Contact match
blocking a candidate before it is ever scored, and a below-WARM score being archived
without ever reaching a human.

#### Known limitations

- No real search/directory API is connected — Phase 3 can only discover candidates via
  manual entry or the three labeled test fixtures. Wiring in a real, ToS-compliant
  source (and only then scaling from 1 → 5 → 20 → batch discovery, per §81) is the
  primary Phase 4 item.
- `websiteDiagnosisLite` is a deterministic simulation, not a real page fetch — it never
  makes an outbound request, so it also never has to handle fetched content as
  `UNTRUSTED_CONTENT`. A real fetch-based diagnosis is a Phase 4 item and must treat
  fetched page content as data, never as instructions to an agent.
- `salesHypothesis()` never proposes a concrete price because no service price table
  exists in this tenant's schema yet; building one (and wiring `priceRecommendation`
  through with an explicit "estimated, not a quote" label) is a Phase 4 item.
- The Sales Settings panel edits score weights/qualification thresholds as raw JSON
  rather than a bespoke slider UI.
- As with Phase 1/2, no live Supabase project was available in this sandbox — Phase 3 is
  verified via the automated tests above plus a real local Postgres run of the migration
  (schema apply, RLS, trigger/backfill behavior — see `supabase/ER.md`), not a real
  browser session.

### AI Sales Execution — Outreach, Meetings, Proposals, WON/LOST (Phase 4)

Phase 4 takes a lead that reached `READY_FOR_OUTREACH` (Phase 3's terminal state) and
carries it through Outreach → Send → Reply → Meeting → Proposal/Estimate → Negotiation →
WON/LOST, ending at the same Contract Workflow Phase 1 already built. **Every external
action (email send, calendar event, proposal delivery) is a separate, explicit human
action from the AI-authored content that precedes it** — nothing in this phase sends,
schedules, or confirms anything on its own.

#### Setup

1. Apply `supabase/migrations/20260917000000_ai_sales_execution_phase4.sql` (after the
   Phase 3 migration). It extends `opportunities` into the full Sales Pipeline entity,
   adds `sales_conversations`/`sales_messages`/`meetings`/`proposals`/`estimates`/
   `service_catalog`/`external_action_logs`, seeds a starter Price Master, and backfills
   6 new agents for existing tenants.
2. From a Lead Detail page (`/office/leads/[id]`) whose lead is `READY_FOR_OUTREACH`,
   open the new **Outreach** tab and click "営業準備を開始".

#### Architecture

- **No real Gmail/Calendar integration exists in this repository** (confirmed by a
  repo-wide search before writing any code — there is no OAuth client, no
  `googleapis`/`nodemailer`, nothing). `lib/sales/emailConnector.ts` and
  `lib/sales/calendarConnector.ts` define `EmailConnector`/`CalendarConnector`
  interfaces with only a `Simulated*` implementation each — deterministic, no network
  calls, exactly the same honesty pattern as Phase 1-3's `TemplateProvider` and test
  fixtures. Wiring a real Gmail OAuth connector and a real Calendar API behind these
  same interfaces is the primary Phase 5 item.
- **Sales Outreach Workflow** (`lib/langgraph/graphs/salesOutreachPrep.ts`): Load Lead
  Research → Select Channel (`lib/sales/channel.ts` — EMAIL only when a contact address
  actually exists; a `test_mode` lead gets a clearly-synthetic `info@<domain>` test
  address, never a guessed real one) → Generate structured Draft (subject/opening/
  personalized observation/problem hypothesis/value proposition/evidence/CTA/signature —
  never a text blob) → Critic (`lib/sales/outreachCritic.ts`: FACTUAL_ACCURACY/
  PERSONALIZATION/TONE/LENGTH/CTA/CLAIM_RISK/PRIVACY/BRAND_SAFETY/DUPLICATE_OUTREACH/DNC,
  capped at 3 revisions) → CEO `sales_send` approval. On approval, a safe
  **Create External Draft** step runs automatically (`sales_messages.status` →
  `READY_TO_SEND`); the actual **Final Send Gate**
  (`POST /api/sales-messages/[id]/send`) is a separate, human-only, role-gated action.
- **Send idempotency** (spec §12, §73): `sales_messages` has a
  `unique (tenant_id, idempotency_key)` constraint, and the Final Send Gate does its
  SENT transition as a single conditional `UPDATE ... WHERE status = 'READY_TO_SEND'` —
  a concurrent duplicate click loses the race harmlessly and gets back the original send
  result instead of sending twice (verified against real Postgres).
- **Reply Monitoring/Classification/Reply Draft** (`lib/langgraph/graphs/replyAnalysis.ts`):
  since there is no real inbox to poll, a human pastes in a test reply via
  `POST /api/sales-messages/[id]/simulate-reply` — restricted to `test_mode` messages
  only. Classification is an explicit, auditable keyword-rule set (never "the model
  understood it"), and a `DO_NOT_CONTACT` classification **never** gets a reply drafted
  (spec §18) — it only raises a CEO alert to confirm the DNC registration.
- **Meeting Conversion**: a `MEETING_REQUEST`/`INTERESTED`/`POSITIVE`/`PRICE_QUESTION`
  reply creates the `opportunities` row for the first time (this is where a Lead
  formally becomes an Opportunity, spec §21/§32) — never earlier, and never for a reply
  that doesn't signal it.
- **Meeting Scheduling/Prep/Minutes** (`meetingScheduling.ts`/`meetingPrep.ts`/
  `meetingMinutes.ts`): AI proposes slots (`SimulatedCalendarConnector.proposeSlots`,
  deterministic, weekday/business-hours only) but never confirms one — a human selects a
  slot via `POST /api/meetings/[id]/select-time` (role-gated, since spec §0 lists
  "商談日時確定" as a Human Approval item), which is what actually creates the
  (simulated) calendar event and logs it to `external_action_logs`. Minutes are
  extracted from a transcript deterministically; anything not found comes back as the
  literal `UNKNOWN`/`UNASSIGNED`/`UNSET` — never a guess (spec §30) — and a human must
  explicitly review (`POST /api/meetings/[id]/minutes/confirm`) before it updates the
  Opportunity's qualification fields.
- **Proposal + Estimate** (`lib/langgraph/graphs/proposalDraft.ts`): refuses to generate
  anything when Goals/Needs/Recommended Services are missing (spec §34) rather than
  inventing content. Prices always come from `service_catalog` via
  `lib/sales/pricing.ts`'s `matchCatalogItem`/`buildEstimate` — a recommended service
  with no catalog match is flagged by the Proposal Critic
  (`lib/sales/proposalCritic.ts`) rather than silently priced. `evaluateDiscountGuard`
  computes the manager/CEO/CEO-with-mandatory-reason tier (spec §44) and shows it on the
  `proposal_approval` CEO approval alongside the (internal-only) margin — this vertical
  slice routes every tier to the single CEO Inbox (no separate manager-approval queue
  exists yet, see Known Limitations). Approving a proposal snapshots its linked
  Estimate into `proposals.price_summary` so a later edit can never retroactively change
  what was actually sent (spec §37/§50); sending is a separate, role-gated action
  (`POST /api/proposals/[id]/send`) logged to `external_action_logs`.
- **Negotiation** (`lib/langgraph/graphs/negotiationAnalysis.ts`): logs the client's
  reaction (reused as a `findings` row, type `negotiation_item`, rather than a new
  table) and has the Negotiation Agent lay out discussion points and a suggested
  discount *ceiling* — it never confirms an actual discount; any real price change goes
  through a new Estimate + `proposal_approval` cycle.
- **WON Gate** (`lib/langgraph/graphs/dealWonGate.ts`): only creates the `deal_won` CEO
  approval once Proposal Sent / Decision Maker / Client Intent Confirmed are all true —
  otherwise it creates nothing at all, since those are real steps a human still has to
  complete, not something to approve past. **Approving `deal_won` reuses the exact same
  `finalizeWonAndStartContract` helper Phase 1's `sales_outreach` approval already used**
  (extracted as a shared function in `lib/server/approvals.ts`) — the already-built
  `sales_graph` → `contract_graph` chain runs completely unchanged (spec §55-56).
- **LOST** (`POST /api/opportunities/[id]/lost`): a plain, role-gated human action (not
  an AI-authored approval) that records `lost_reason` into `decision_memories` for
  Decision Learning. `GET /api/sales/lost-analysis` is a plain aggregation over those
  human-recorded reasons — there is no AI "guessing" involved at all, so spec §58's
  "separate AI inference from confirmed reasons" requirement is met trivially.
- **AI Office / CEO Inbox**: `sales_send`/`sales_reply`/`proposal_approval`/`deal_won`
  are fully wired into the same Approve/Edit&Approve/Reject/Hold/Do Not Contact CEO
  Inbox flow as `sales_lead` (generalized in `lib/server/approvals.ts` and
  `components/office/CeoInbox.tsx`, not a parallel system). Lead Detail gained an
  **Outreach** tab (conversation thread, Send Now, test-reply simulation); a new
  **Opportunity Detail** page (`/office/opportunities/[id]`) is the hub for
  Meetings/Proposal-Estimate/Negotiation/Approvals/WON-LOST for everything past Meeting
  Conversion; the Leads panel shows a compact Sales Pipeline funnel.
- **Capability-based agent selection** (spec §2): `agents.capabilities` (already existed
  as an unused jsonb column since Phase 1) is now populated and actually read —
  `lib/langgraph/context.ts`'s new `getAgentByCapability()` looks an agent up by what it
  can do (e.g. `"channel_selection"`, `"proposal_draft"`) with a safe fallback code, so
  headcount/naming for the AI Sales Execution roster stays entirely DB-driven.

#### Tests

Unit tests for every pure function introduced this phase: `emailConnector.test.ts` /
`calendarConnector.test.ts` (never claim to be real, deterministic), `channel.test.ts`,
`outreachCritic.test.ts`, `proposalCritic.test.ts`, `pricing.test.ts` (estimate math,
catalog matching, discount guard). `lib/langgraph/graphs/salesExecution.integration.test.ts`
runs the entire §94 vertical slice against the fake in-memory Supabase — one
READY_FOR_OUTREACH lead through Outreach → Send → Reply (Meeting Conversion) →
Scheduling → Prep → Minutes → Proposal/Estimate → Approval → Send → Negotiation → WON
Gate → `deal_won` approval → the existing `sales_graph`/`contract_graph` handoff. Two
real bugs were caught and fixed by these tests during this phase's own development (see
below).

#### Bugs found and fixed by this phase's own tests

- `checkDuplicate()` (Phase 3) was being called *after* the candidate's own lead row was
  already inserted, so every domain-having candidate matched itself as an "existing
  lead." Fixed with an `excludeLeadId` parameter; caught by Phase 3's own
  `leadDiscovery.integration.test.ts`, carried here as context since it was fixed in
  this session.
- `salesOutreachPrep.ts`'s `load_lead_research` node always set `evidenceSourceUrl:
  null`, so the outreach email's `evidence` array was *always* empty regardless of a
  real website-staleness finding — every outreach draft failed the Critic's
  PERSONALIZATION check. Fixed by using the lead's own website URL as the evidence
  source when a website finding actually produced evidence text; caught by
  `salesExecution.integration.test.ts`.

#### Known limitations

- No real Gmail/Calendar integration — see Architecture above. This is the single
  biggest Phase 5 item; until it lands, "send" and "schedule" are simulated end-to-end
  but never leave this application.
- Meeting Action Items stay as reviewed structured data on the meeting
  (`meetings.minutes.actionItems`) rather than becoming real `tasks` rows:
  `tasks.project_id` is `NOT NULL` and no project exists until WON → Contract →
  Onboarding creates one. Wiring these into real Tasks once a project exists is a
  Phase 5 item.
- Discount Guard tiers (manager/CEO/CEO-with-reason) are computed and shown, but this
  vertical slice has only one approval queue (CEO Inbox) — there is no separate
  manager-level approval routing yet.
- Proposals/Estimates are always created at `version = 1`; re-running
  `POST /api/opportunities/[id]/proposals` after a Negotiation-driven change creates a
  new proposal rather than a true v2 with reconciliation against the old version (spec
  §53). Real version reconciliation is a Phase 5 item.
- No Proposal/Estimate document generation (PDF/PPT/Word) exists — Proposal/Estimate
  content is structured data only, viewed in the Opportunity Detail page. `File Security`
  concerns (spec §75) don't yet apply because there are no files to scope.
- SLA timers, Follow-up limits/scheduling, and a Business Calendar (spec §66-70) are not
  implemented — there is no automated reminder or follow-up cadence yet.
- As with Phases 1-3, no live Supabase project was available in this sandbox — Phase 4
  is verified via the automated tests above plus a real local Postgres run of the
  migration (schema apply, RLS, FK/unique-constraint behavior, trigger/backfill — see
  `supabase/ER.md`), not a real browser session.

### Production Sales Operations — OAuth, Versioning, Documents, SLA (Phase 5)

Phase 5 raises the sales-to-WON path from "demo" to "production-usable": real Google
OAuth (Gmail/Calendar) behind the *unchanged* Phase 4 `EmailConnector`/
`CalendarConnector` interfaces, a Manager Approval Queue, immutable Proposal/Estimate
versioning with a Reconciliation Engine, real PDF/PPTX generation with File Security,
Meeting Action Items with Human Confirm + Task conversion, and a Business Calendar / SLA
/ Follow-up / Scheduler layer. Every Phase 5 item traces back to a Phase 4 "Known
limitation" line above.

#### Setup

1. Apply the three new migrations in order after Phase 4's:
   `20260919000000_production_sales_ops_phase5.sql` (integrations, versioning columns,
   manager role, calendars/SLA/followup/files/jobs tables),
   `20260921000000_approval_snapshot_invalidation.sql` (adds `APPROVAL_INVALIDATED` to
   `sales_messages.status`), `20260922000000_file_security_and_delivery.sql` (makes
   `file_access_logs.performed_by_user_id` nullable for external signed-link downloads).
2. Optional env vars (all absent-safe — every real feature falls back to its Phase
   1-4 Simulated/manual behavior when unset): `GOOGLE_OAUTH_CLIENT_ID` /
   `GOOGLE_OAUTH_CLIENT_SECRET` (real Gmail/Calendar), `TOKEN_ENCRYPTION_KEY` (required
   once Google OAuth is configured — AES-256-GCM key for tokens at rest),
   `FILE_SIGNING_SECRET` (required once a share-link is issued — HMAC key for signed
   file URLs), `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` (required for `/api/cron/*`
   and the public signed-file-download route). See `.env.example`.
3. From the Header's user menu, "連携設定（Google）" opens Integrations settings to
   connect/disconnect Google.

#### Architecture

- **Real Google OAuth, same interfaces** (spec §5-12): `lib/integrations/oauth.ts`
  implements the Authorization Code Flow + PKCE against Google's official endpoints
  only (explicitly never: stored password, cookie theft, session reuse, unofficial
  APIs, scraping). Minimum-necessary scopes only —
  `gmail.compose`+`gmail.readonly`+`calendar.events`, each with its rationale
  documented in code — never `https://mail.google.com/`, mail settings, or Contacts.
  `oauth_states` holds the PKCE verifier + a single-use `state` server-side;
  `consumeOAuthState()` verifies it against the same tenant+user+provider that started
  the flow and marks it consumed, so a callback's `state` is never trusted from the
  request alone (CSRF defense, spec §6). Tokens are AES-256-GCM-encrypted at rest
  (`lib/integrations/crypto.ts`) — never logged anywhere, not even on a refresh
  failure — and `getValidAccessToken()` (`lib/integrations/tokenStore.ts`)
  auto-refreshes near expiry, transitioning to `needs_reauth` on failure (never an
  infinite retry loop) with bounded exponential backoff on Google's 429s
  (`lib/integrations/httpRetry.ts`).
- **`GoogleGmailConnector`/`GoogleCalendarConnector`** (`lib/integrations/`) implement
  the *exact same* `EmailConnector`/`CalendarConnector` interfaces Phase 4 defined —
  never touched. `getEmailConnector()`/`getCalendarConnector()` (still in
  `lib/sales/`) now take an optional `{supabase, tenantId, userId}` and pick the real
  connector only when that user has a `connected` Google integration; every other case
  (no ctx, not configured, not connected) falls back to Simulated exactly as before, so
  every pre-Phase-5 call site keeps working unless Google is actually wired up.
  `GoogleCalendarConnector.proposeSlots()` deliberately stays the same synchronous
  heuristic as Simulated (the interface predates async free/busy and isn't changed
  here) — the real safety property ("AI never confirms a meeting alone", no
  double-booking) is still enforced by a live `freeBusy.query` check inside
  `createEvent()` immediately before inserting.
- **Manager Approval Queue** (spec §51-53): `memberships.role` gains `manager`.
  `approval_policies` (tenant-editable, data-driven: `conditions` like
  `{"amountGte": 300000}` → `steps` like `[{"role":"manager"},{"role":"ceo"}]`) drives
  `lib/server/approvalPolicy.ts`'s `computeApprovalSteps()`, stored on
  `approval_requests.steps`/`current_step`. `decideApproval()` authorizes step-by-step
  when a chain exists (advancing without finalizing until the last step approves) and
  falls back to the *exact* legacy owner/ceo/admin-only path when `steps` is empty —
  every approval type from Phases 1-4 is completely unaffected. Only `sales_send` and
  `proposal_approval` compute real steps this phase; CEO Inbox and Manager Inbox are
  the same `approval_requests` table and the same `decideApproval()` engine, split only
  by what the UI shows (spec's "display-only split").
- **Approval Snapshot Hash + expiration** (spec §45, §63-64):
  `lib/server/approvalSnapshot.ts`'s `computeSnapshotHash()`/`checkSnapshot()` hash the
  fields that must not change between approval and execution. `sales_send` approvals
  now carry a `snapshot_hash` + 72h `expires_at`; the Final Send Gate
  (`lib/server/salesSendGate.ts`) re-verifies the hash, expiry, and a fresh Do Not
  Contact check immediately before sending, marking the message
  `APPROVAL_INVALIDATED` and refusing to send on any mismatch — re-approval is
  required, never "send anyway."
- **Immutable Proposal/Estimate versioning + Reconciliation Engine** (spec §37-39,
  §46-48): `content_json`/`snapshot_hash` on `proposals`/`estimates` are the Source of
  Truth for rendering, protected by real Postgres `BEFORE UPDATE` triggers once a
  version reaches APPROVED/SENT/ACCEPTED (verified against local Postgres: status-only
  transitions pass, content edits are rejected). `POST /api/proposals/[id]/new-version`
  and `.../estimates/[id]/new-version` are the only way to change anything past that
  point — a new version row, `previous_version_id` set, status reset to DRAFT, a
  required `change_summary`. `lib/sales/reconciliation.ts`'s
  `reconcileProposalAndEstimate()` compares a proposal's `scope` against what its
  estimate actually prices (via the same `matchCatalogItem` heuristic the estimate
  generation step used) → MATCH/WARNING/BLOCKING_MISMATCH, surfaced on the approval and
  re-checked at `POST /api/proposals/[id]/send` — even an already-approved proposal is
  refused delivery on BLOCKING_MISMATCH.
- **Meeting Action Items** (spec §21-26): a real `meeting_action_items` table (not
  jsonb on `meetings` — this phase's Human Confirm/duplicate-detection/Task
  traceability genuinely need first-class rows). Candidates are extracted from a
  transcript by the same deterministic keyword-cue discipline as
  `TemplateProvider`'s other regex extractions (`lib/sales/meetingActionItems.ts`) —
  owner/due date always stay `null` until a human sets them at Confirm time, never
  guessed. Each candidate is checked against the Opportunity's existing non-rejected
  items and flagged `possible_duplicate_of` on a match — surfaced to a human, never
  auto-merged/deleted. "Convert to Project Task" only becomes possible once a real
  Project exists (WON → Contract → Onboarding, same `tasks.project_id NOT NULL`
  constraint noted in Phase 4's limitations) — before that, items simply stay
  Opportunity-level.
- **Real PDF/PPTX generation + Delivery Package + File Security** (spec §34-49):
  `lib/documents/proposalPdf.ts` (pdfkit) and `proposalPptx.ts` (pptxgenjs) render
  purely from a proposal/estimate's `content_json` — never live DB fields that could
  move on after a version is approved, so a rendered file never silently changes
  later. `generated_files` (bytes stored directly in Postgres `bytea` — no object
  storage exists in this sandbox, see limitations) classifies INTERNAL vs
  CLIENT_VISIBLE from the proposal's own status: only APPROVED/SENT/ACCEPTED is ever
  shareable. `delivery_packages` bundle a proposal + estimate + their CLIENT_VISIBLE
  files; sending re-checks every attachment is still CLIENT_VISIBLE. Sharing uses
  short-lived (5-30 min clamped), HMAC-signed URLs
  (`lib/server/fileSecurity.ts`) — never a permanent public link — redeemed through
  the one public route in this codebase (`/api/files/download`) via the service-role
  client (the external recipient has no Supabase Auth session at all; the signature is
  the security boundary). Every download/share is logged to `file_access_logs`,
  including external redemptions (`performed_by_user_id = null`, since there is no
  human tenant user to attribute those to — the access itself is still audited).
- **Business Calendar / SLA / Follow-up / Scheduler** (spec §58-73):
  `lib/server/businessCalendar.ts` does real wall-clock math via `Intl.DateTimeFormat`
  in a tenant's own IANA timezone (default Asia/Tokyo, Mon-Fri) — never a naive
  24-hour diff — skipping weekends/holidays for `business_hours`/`business_days`
  targets (plain `hours`/`days` stay naive on purpose, per spec's own unit
  distinction). `lib/server/slaEngine.ts` fixes `sla_due_at` at creation time (wired
  into the high-risk contract approval this phase) and never recomputes it later, only
  its `sla_status` label. `lib/sales/followupEngine.ts` +
  `lib/server/followupCheck.ts` create only human-approvable `followup_candidates` —
  "never auto-send" has no exception anywhere in this code path. Three
  `/api/cron/*` routes (`sla-check`, `token-refresh`, `followup-check`), each gated by
  `CRON_SECRET` and using the service-role client, are wrapped by
  `lib/server/backgroundJob.ts`'s Job Idempotency lock (`background_jobs.job_key`) so
  an overlapping trigger never runs the same job concurrently.

#### Tests

Every new pure module has unit tests: `businessCalendar.test.ts` (13 cases — business
day/hour math, weekend/holiday skipping), `slaEngine.test.ts`, `followupEngine.test.ts`
+ `followupCheck.test.ts`, `reconciliation.test.ts`, `approvalSnapshot.test.ts` +
`salesSendGate.test.ts`, `approvalPolicy.test.ts`, `crypto.test.ts` + `oauth.test.ts` +
`tokenStore.test.ts` (mocked Google endpoints, never real network),
`googleGmailConnector.test.ts` + `googleCalendarConnector.test.ts`, `fileSecurity.test.ts`
(signed-token forgery/expiry), `bytea.test.ts`, `documentGeneration.test.ts` +
`proposalDocument.test.ts` (real PDF/PPTX byte output — `%PDF-`/`PK` magic bytes),
`deliveryPackage.test.ts`, `proposalVersioning.test.ts` + `estimateVersioning.test.ts`.
`lib/langgraph/graphs/phase5VerticalSlice.integration.test.ts` chains the biggest new
pieces together against the fake in-memory Supabase: a high-value proposal through the
2-step manager→ceo Approval Queue (reconciliation MATCH surfaced along the way), real
PDF/PPTX generation once approved, a Delivery Package created and sent, plus separate
cases for Approval Snapshot Hash invalidation and Business-Time SLA computation. All
251 tests pass; `npx tsc --noEmit`, `npx eslint .`, and `npm run build` are clean.

#### Known limitations

- **No live Google OAuth credentials exist in this sandbox** — the OAuth
  flow/connectors are real, tested code (mocked Google endpoints in unit tests), but
  never exercised against the actual Google API end-to-end. This is the same
  fundamental sandbox constraint noted for every prior phase's "no live Supabase
  project" limitation, just for a second external provider.
- `GoogleCalendarConnector.proposeSlots()` stays a heuristic, not a live free/busy
  query (see Architecture above) — the interface predates async and isn't changed
  here; the actual double-booking safety net is `createEvent()`'s live check.
- No object storage (S3/GCS) exists in this sandbox — generated files live in a
  Postgres `bytea` column. `storage_path` is kept as the logical name a real
  deployment would use once real object storage is wired in.
- Reply Sync, a live Calendar-sync job, and a live Gmail-thread-check job are
  designed for (the connectors and job-idempotency infrastructure exist) but not
  wired into a `/api/cron/*` route this phase — only `sla-check`/`token-refresh`/
  `followup-check` are. Real thread-scoped Gmail polling has no Gmail data to poll in
  this sandbox regardless.
- Outlook/Microsoft Calendar, Slack/Teams/Chatwork, e-contract APIs, billing/Stripe/
  freee/MoneyForward integration, and fully-automatic send/reply remain explicitly
  out of scope (per the product brief itself) — the Connector interface extension
  points are preserved for them.
- As with Phases 1-4, no live Supabase project was available in this sandbox — Phase 5
  is verified via the automated tests above plus real local Postgres runs of all three
  new migrations (schema apply, new-status-value acceptance,
  nullable-column-with-FK-intact — see `supabase/ER.md`), not a real browser session.

### Growth Loop — Measurement, Reporting, Renewal, Upsell (Phase 7)

Phase 7 turns "wins and executes a deal" into "measures outcomes, explains them, and
drives its own continuation/expansion revenue": READY_FOR_DELIVERY/DELIVERED are split
into distinct states, a delivered project's KPIs get a Measurement Plan and Baseline
Snapshot, Effect Evaluation runs on deterministic rules (never an LLM's own success
judgment), a Monthly Report goes through Critic → QA → Manager/CEO approval → a
separate Human Delivery, and the same pass checks Contract Renewal due-dates/health and
detects Upsell candidates that convert into new Sales Opportunities on the *existing*
pipeline once approved.

#### Setup

1. Apply `20260924000000_growth_loop_phase7.sql` after Phase 5's three migrations.
2. No new env vars — the Growth Loop scheduler reuses `CRON_SECRET` +
   `SUPABASE_SERVICE_ROLE_KEY` already required for `/api/cron/*` (Phase 5). A fourth
   cron route, `/api/cron/growth-loop-check`, should be scheduled hourly-or-slower
   alongside the existing three.
3. KPIs with no connector are entered via `POST /api/kpis/[id]/manual-value`
   (`{value, reason}`) — always audited, tagged `source: "manual"`.

#### Architecture

- **READY_FOR_DELIVERY vs DELIVERED** (spec §2-4): `projects.status` gained
  `ready_for_delivery` as a distinct state before `delivered`. The pre-existing
  `delivery_graph` (Phase 1) now only reaches `ready_for_delivery` once the internal
  Manager+CEO "delivery" approval clears; a new `delivery_records` table (client,
  deliverable ids, channel, recipient, snapshot hash, notes) plus the explicit
  `POST /api/projects/[id]/delivery/confirm` Human Action
  (`lib/server/deliveryConfirmation.ts`) is what actually reaches `delivered` — and
  that same call is what fires the Measurement Trigger (`measurement_graph`).
- **Measurement Plan / Baseline / KPI Snapshot** (spec §5-18): `measurement_plans`
  (one per KPI, `PLANNED → WAITING → READY_TO_EVALUATE → COMPLETED/INSUFFICIENT_DATA`)
  and `kpi_snapshots` (`BASELINE`/`CURRENT`/`CUSTOM`, each carrying its own
  `data_quality`) are new, first-class tables — a Baseline is fixed the moment
  measurement starts tracking a KPI and never re-derived later even if
  `kpis.current_value` moves on. `lib/server/measurement.ts`'s `computeChange()` /
  `computeTargetGap()` are zero-division-safe by construction (a `baseline = 0` never
  produces a `%` change, only an absolute one — no `Infinity` anywhere).
  `resolveMeasurementStartDelayDays()` encodes the SEO(14d)/Content(28d)/CRO(28d)/
  Ads(7d) trigger table from spec §4 (via a `kpis.initiative_type` hint; unset
  defaults to 14d).
- **Effect Evaluation is a Deterministic Rule, not an LLM decision** (spec §19-23):
  `evaluateEffect()` classifies SUCCESS/PARTIAL_SUCCESS/NO_SIGNIFICANT_CHANGE/
  NEGATIVE/INCONCLUSIVE/INSUFFICIENT_DATA purely from baseline/current/target/
  direction/data-quality/minimum-data-requirement, with a Confidence
  (HIGH/MEDIUM/LOW) that a confounding-factor flag downgrades by exactly one step.
  `measurement_graph`'s `evaluate_effect` step still runs through `runAgentStep()`
  (attributed to the `mina`/Analytics agent for AI Office visibility) but the
  classification itself is this pure function, unit-tested against the spec's own
  Test Cases A (10→17 vs target 20 ⇒ PARTIAL_SUCCESS), B (missing data ⇒
  INSUFFICIENT_DATA, never a guessed number), and C (10→6 ⇒ NEGATIVE + a CRITICAL
  anomaly).
- **Anomaly Detection** (spec §26-29): `detectAnomaly()` is a plain, direction-aware
  percentage-move threshold (±10/15/25/40% ⇒ INFO/WARNING/HIGH/CRITICAL) — no ML,
  per the spec's own "高度MLを初期から入れない". A HIGH/CRITICAL anomaly triggers a
  Root Cause candidate (`root_cause_analysis` provider task, stored as a `findings`
  row of `type='root_cause_candidate'`, reusing Phase 1's `findings` table rather than
  a new one) and, on CRITICAL, an `anomaly.critical_alert` event surfaced to the CEO/
  Manager feed — this vertical slice does not yet add a dedicated push/email channel
  for it (see Known limitations).
- **Monthly Reporting Cycle** (spec §34-53): `reporting_cycles` (unique per
  `project + period_start`, so a scheduler tick never double-drafts the same month)
  and `monthly_reports` (immutable once APPROVED/CLIENT_PREVIEW/DELIVERED, via the
  exact same `content_json` + `BEFORE UPDATE` trigger pattern as Phase 5's
  proposals/estimates) carry the report through `DRAFT → CRITIC_REVIEW/REVISION → QA →
  MANAGER_REVIEW → CEO_REVIEW → APPROVED → DELIVERED`. `content_json`
  (`lib/documents/monthlyReportDocument.ts`) is already client-safe by construction —
  no cost/margin/critic notes are ever written into it — and is rendered to a real PDF
  (`lib/documents/monthlyReportPdf.ts`, pdfkit) via `generateMonthlyReportFile()`
  (same INTERNAL/CLIENT_VISIBLE classification-by-status rule as Phase 5's proposal
  files). `GET /api/monthly-reports/[id]` (Client Preview) selects only client-safe
  columns at the API layer, not just the UI (spec §163) — `critic_notes`/`qa_notes`
  are excluded from that response entirely. `POST /api/monthly-reports/[id]/deliver`
  is the separate, explicit Human Send that reaches `DELIVERED` and closes the
  `reporting_cycle` — approval alone never sends anything to the client, same
  Approve-vs-Send split as project delivery.
- **Renewal Management + Account Health** (spec §62-71): `contract_renewals`
  (unique per `contract + current_end_date`) tracks `NOT_DUE → UPCOMING → …`;
  `computeRenewalDueStatus()` enters `UPCOMING` once inside the earliest of the
  90/60/30-day trigger windows. `computeRenewalHealth()` is a deterministic,
  always-explained (never a bare score, spec §67) GREEN/YELLOW/RED score from KPI
  achievement ratio, open Critical anomalies, and (where trackable) client sentiment/
  payment/margin — the latter three have no data source in this sandbox yet (no
  cost-tracking, attendance, or payments system exists) and simply don't contribute a
  risk point rather than being guessed.
- **Upsell Detection → Critic → Approval → Opportunity Conversion** (spec §72-82,
  §140-143): `renewal_graph`'s `detect_upsell` node infers a candidate service from a
  KPI showing NEGATIVE or PARTIAL_SUCCESS (a persistent gap, per the spec's own
  Test Case A "still short of target ⇒ propose CRO"), then runs
  `checkUpsellDuplicate()` (an open candidate or an active Cooldown for the same
  client+service silently skips re-detection) and `criticUpsellCandidate()` (rejects a
  service already inside the client's current contract scope — Test Case E — a
  missing stated Client Benefit, or a Client-Fatigue limit breach) before a
  `upsell_opportunities` row and Manager+CEO approval request are even created — a
  Critic-failed candidate never reaches a human. Approving it
  (`lib/server/approvals.ts`'s `applyApproval` for `upsell_opportunity`) converts it
  into a **new Sales Opportunity on the existing pipeline** (spec §79): a lightweight
  "already a client" `leads` row (`source: "upsell_expansion"`) satisfies the
  pre-existing `opportunities.lead_id NOT NULL` constraint without inventing a
  parallel sales data model, and the new `opportunities` row starts at `QUALIFIED`
  (skipping cold-outreach stages) carrying the recommended service/estimated value. A
  human reject (Test Case F) records the reason and starts a 90-day Cooldown
  (`computeCooldownUntil()`).
- **Scheduler** (spec §123-125): `POST /api/cron/growth-loop-check` sweeps every
  tenant's `ready_for_delivery`/`delivered` projects and re-runs `measurement_graph` +
  `renewal_graph`, wrapped in the same `runBackgroundJob()` idempotency lock as the
  Phase 5 cron jobs; a single project's failure is caught and logged without aborting
  the sweep for the rest (spec §125 — a connector/KPI failure must never break the
  whole cycle). Both graphs are independently idempotent per period
  (`measurement_plans`' terminal-status guard, `reporting_cycles`'/
  `contract_renewals`' unique-per-period constraints), so an overlapping or repeated
  tick never double-drafts a report or double-detects the same renewal/upsell.
- **AI Office / Project Room integration**: the `mina`(Analytics/Measurement)/
  `repo`(Report)/`kuro`(Critic)/`qa`/`renewal`(new)/`upsell`(new) agents all run
  through the existing `runAgentStep()`/`agent_events` instrumentation, so Growth
  Loop activity shows up in the Activity Feed (new `growth` filter tab) exactly like
  every other agent action. Project Room gained a **Growth Loop** panel (Measurement
  Plan status/evaluation, Monthly Report versions/status, Renewal due-date/health,
  Upsell Opportunities) and a **Human Delivery** button that appears once a project
  reaches `ready_for_delivery`. CEO Inbox recognizes the two new approval types
  (`monthly_report`, `upsell_opportunity`), including Hold.

#### Tests

New unit tests: `measurement.test.ts` (zero-division safety, KPI status
classification, Effect Evaluation against spec Test Cases A/B/C, Anomaly Detection
direction-awareness), `renewalRisk.test.ts` (due-date trigger window, Test Case D,
health-score explanation), `upsell.test.ts` (duplicate/cooldown guard — Test Case F,
Critic rejection — Test Case E, Client Fatigue limit).
`lib/langgraph/graphs/growthLoop.integration.test.ts` chains the entire vertical slice
against the fake in-memory Supabase — Human Delivery → Baseline → manual current-KPI
input → scheduler-equivalent evaluation (PARTIAL_SUCCESS) → Monthly Report Draft →
Critic → QA → Manager+CEO approval → Client Preview (asserts no internal notes leak
into `content_json`) → Human Delivery of the report (real CLIENT_VISIBLE PDF) →
Renewal Due detection → Upsell Detection → Critic → Manager+CEO approval → Opportunity
Conversion — plus the two auto-reject/human-reject edge cases (E, F) as separate
cases. The pre-existing Phase 1 `fullFlow.integration.test.ts` was updated for the
READY_FOR_DELIVERY/DELIVERED split (it now calls `confirmProjectDelivery()` as its
final step, same as a real Human Delivery would). All 285 tests pass; `npx tsc
--noEmit`, `npx eslint .`, and `npm run build` are clean.

#### Known limitations

- **No real analytics connectors** (GA4/GSC/Google Ads/Semrush/Clarity/GBP) exist yet
  — every KPI in this phase is `source: "manual"` or whatever a prior phase's
  simulated pipeline wrote to `kpis.current_value`. The `kpi_snapshots.source` column
  and `kpis.source` check-constraint already enumerate the target connectors so this
  is a additive Phase 8 item, not a schema change.
- **Client Portal, a dedicated Measurement/Report/Renewal/Upsell/Executive Dashboard
  UI, and an Account Room page are not built this phase** — the underlying data
  (measurement_plans, monthly_reports, contract_renewals, upsell_opportunities,
  delivery_records) is fully modeled, RLS-protected, and exercised end-to-end by the
  vertical-slice test above, and surfaced minimally inside the existing Project Room's
  new "Growth Loop" panel + CEO Inbox — but the five dedicated "Center" screens the
  product brief describes (§116-119, §176-180) and a standalone Executive/Account
  Health dashboard are a Phase 8 UI item.
- **MRR/ARR/NRR/GRR, Client Profitability (margin), and Expansion Score are not
  computed** — no cost-tracking, billing, or payment system exists in this codebase
  yet, so `computeRenewalHealth()`'s margin/payment factors simply never contribute a
  risk point rather than being guessed, and the Executive Dashboard's financial
  rollups (spec §86-90, §147-148) have no real inputs to compute from yet.
  `lib/sales/pricing.ts`'s existing internal-cost/margin math is the only
  profitability data this codebase has, and it is estimate-level, not account-level.
- **Client sentiment, meeting-attendance tracking, and payment status** have no data
  source (no Client Feedback table, no meeting-attendance field, no billing system),
  so `computeRenewalHealth()` treats them as unknown (never guessed) rather than
  penalizing or crediting a health score for them.
- **A single measurement window per KPI per delivery, not a rolling monthly
  re-baseline** — `ensure_measurement_plans` only opens a new plan once the previous
  one for that KPI reaches a terminal status; a genuinely period-over-period (MoM/YoY)
  re-baselining scheduler refinement is a Phase 8 item, though `comparison_type` on
  `measurement_plans` already reserves the enum values for it.
- **Report output is PDF only** — PPTX/DOCX monthly report export, brand-specific
  templates, and Client Comment/Decision-Request threads on a delivered report are not
  built this phase (the `generated_files`/`delivery_packages` infrastructure they'd
  reuse already exists from Phase 5).
- Fully-automatic client send/contract renewal/price change, Stripe/freee/
  MoneyForward billing, advanced predictive/ML churn models, and a dedicated
  Renewal/Upsell Proposal document distinct from the existing Proposal Engine remain
  explicitly out of scope (per the product brief itself, §175) — Renewal/Upsell
  Proposals are designed to reuse the existing Proposal/Estimate engine once a human
  decides to act on an approved Upsell Opportunity or Renewal.
- As with every prior phase, no live Supabase project was available in this sandbox —
  Phase 7 is verified via the automated tests above (including the full vertical-slice
  integration test) against the fake in-memory Supabase, plus a real local Postgres 16
  run of all 8 migrations in order (schema apply, the new
  `projects_status_check`/`generated_files_entity_type_check` constraints accepting
  the new values and rejecting invalid ones, the `monthly_reports` immutability
  trigger rejecting a content edit on an APPROVED row while a status-only transition
  succeeds, RLS enabled with 4 policies on every new table, and two independent
  tenants each getting their own `renewal`/`upsell` agents and
  `monthly_report`/`upsell_opportunity` approval policies via the tenant-provisioning
  trigger) — not a real browser session.

### AI Company Autonomy Runtime — "PHASE 1" of the Autonomy roadmap

A closed Objective → Observe → Plan → Authorize → Execute → Verify → Assess Impact →
Supervise loop, built on top of everything above without modifying any of the 18
existing LangGraph pipelines, the orchestrator's dispatch mechanism, the checkpointer,
or RLS/tenancy. Fully documented in **`docs/ai-company-os-phase1/`** — start at
`01_ARCHITECTURE.md` for the map, `00_IMPLEMENTATION_PLAN.md` for the authorized
design rationale, and `12_PHASE1_COMPLETION_REPORT.md` for what shipped vs. what's
deferred.

#### Setup

Disabled by default for every tenant (`tenant_autonomy_settings.feature_enabled =
false`) — zero behavior change unless explicitly enabled. Requires the three
migrations under `supabase/migrations/2026092{5,6,7}*_ai_company_os_phase1_*.sql`
applied (additive-only; **not yet run against any live Postgres** — see
`docs/ai-company-os-phase1/11_OPERATIONS.md`), `CRON_SECRET` (shared with the
existing cron routes), and `ANTHROPIC_API_KEY` only if a tenant is promoted to
`ASSISTED`/`ACTIVE` mode (Fail-Closed otherwise — see `.env.example`).

#### Architecture

Seven stage modules under `lib/autonomy/` (`observer`, `planner`, `authorityEngine`,
`executionAdapter`, `verifier`, `impactAssessor`, `supervisor`) composed by
`cycleRunner.ts::runObjectiveCycle()`, driven hourly by
`app/api/cron/objective-observer/route.ts` (wired into `vercel.json`). A minimal
Pilot Cockpit at `/office/autonomy` (read-only projection of the same DB rows, plus
the Emergency Stop Kill Switch toggle) is the only new UI surface. See
`docs/ai-company-os-phase1/01_ARCHITECTURE.md` for the full pipeline diagram and file
map, and the sibling docs for each subsystem.

#### Tests

458/458 tests passing (grown from the 291 baseline before this work began), across
70 files, including a required 2-Cycle Closed Loop integration test proving two
genuinely different Planner decisions across consecutive cycles
(`lib/autonomy/closedLoop.integration.test.ts`) and a dedicated tenant-isolation +
feature-disabled-zero-side-effects security suite
(`lib/autonomy/tenantIsolation.test.ts`, `lib/autonomy/featureDisabledRegression.test.ts`).
`npx tsc --noEmit`, `npx eslint .`, and `npm run build` are clean. See
`docs/ai-company-os-phase1/10_SECURITY.md` and `12_PHASE1_COMPLETION_REPORT.md`.

#### Known limitations

See `docs/ai-company-os-phase1/12_PHASE1_COMPLETION_REPORT.md §12.4` for the full,
stated list (no live Postgres available during development; in-flight execution
cannot be forcibly cancelled by the Kill Switch; only 2 of the 18 registered Skills
are dispatchable in this phase; cost estimation is a flat placeholder pending real
per-token costing).
