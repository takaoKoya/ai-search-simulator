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

### Known Phase 1 limitations

- CEO Inbox supports Approve / Reject / Request Revision; "Edit and Approve" (editing the
  AI-drafted content inline before approving) is not implemented yet.
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
