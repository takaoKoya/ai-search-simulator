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
