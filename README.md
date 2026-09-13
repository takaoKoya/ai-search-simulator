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
