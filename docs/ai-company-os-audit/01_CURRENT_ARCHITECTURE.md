# 01 — Current Architecture

**Audit phase:** PHASE 0 — Existing System & Autonomy Audit
**Status:** Read-only. No code, schema, or config was changed to produce this document.
**Repo:** `ai-search-simulator` (Next.js 16 App Router + Supabase Postgres, multi-tenant)

## 1.1 What this system physically is

A single Next.js application with two unrelated product surfaces sharing one codebase and one login screen:

1. **The AI Company OS** (`/office/**`) — a multi-tenant B2B sales/delivery/growth-loop automation product, built across 7 "phases" (init → Phase 1 → Phase 3 → Phase 4 → Phase 5 → approval-hardening → file-security → Phase 7). This is the system PHASE 0 audits.
2. **Two unrelated legacy/parallel surfaces**: a "YATTORU" personal task app (`/home`, `/task/today`), and a standalone scripted demo (`/webops`) that visualizes an "AI social-media team" but is 100% client-side, hardcoded, and touches no backend table. Root `/` is a third, unrelated "AI search-visibility simulator" calculator. None of these three shares a code path with `/office`. (UI audit agent; API/route audit agent.)

## 1.2 Layered architecture, as it actually exists

```
Browser (Next.js client components, polling every 4-6s)
   │
   ▼
Next.js Server Components (SSR initial state) + API Routes (app/api/**)
   │  every route: getTenantContext() → tenant_id + role from session, NEVER from request
   ▼
lib/server/*.ts  (business logic: approvals, sales, projects, delivery, files, OAuth)
   │
   ├──► lib/langgraph/orchestrator.ts::runBusinessGraph(graphName, ...)
   │        │  a switch/dispatch over 18 hardcoded graph names — NOT a planner
   │        ▼
   │    lib/langgraph/graphs/*.ts (18 fixed LangGraph StateGraph pipelines)
   │        │  each node: 1-3 targeted Supabase reads → lib/ai/provider.ts::TemplateProvider.generate()
   │        │  (deterministic, seeded-hash rule engine — ZERO LLM calls, zero network calls)
   │        ▼
   │    lib/langgraph/checkpointer.ts (SupabaseCheckpointSaver → workflow_checkpoints/_writes)
   │
   ├──► lib/integrations/* (real Gmail send + draft, real Google Calendar freebusy+create,
   │        gated behind OAuth connection state; falls back to a simulated connector otherwise)
   │
   └──► lib/documents/* (real PDF/PPTX generation via pdfkit/pptxgenjs, stored as Postgres bytea)
   │
   ▼
Supabase Postgres (56 tables, RLS on every table, tenant_id-scoped via is_tenant_member()/has_tenant_role())
```

## 1.3 The four things that most define this system's current shape

1. **Every unit of AI work is a fixed, human-authored LangGraph pipeline**, not an agent that plans. 18 graphs exist; every node sequence is hardcoded via `.addEdge`; the only branching is deterministic (score thresholds, critic pass/fail, precondition checklists). See `05_AGENT_RUNTIME_AUDIT.md`.
2. **"AI" is a deterministic template renderer, not an LLM.** `lib/ai/provider.ts`'s `TemplateProvider` is the only class implementing `AIProvider` in the whole repo; there is no OpenAI/Anthropic/Gemini/embeddings dependency anywhere in `package.json`. See `07_MEMORY_KNOWLEDGE_AUDIT.md` and `08_TOOL_CONNECTOR_AUDIT.md`.
3. **Almost every transition requires a human click.** Of 18 graphs, 16 start only from a human-triggered API route; the 2 that can start from a cron tick (`measurement_graph`, `renewal_graph`) still only run because `growth-loop-check` happens to be hit — and nothing in this repo currently calls it (no `vercel.json`, no scheduler). Exactly one graph→graph auto-chain exists with no human action in between (`onboarding_graph → execution_graph`), and it is a single hardcoded `if` in the orchestrator, not agent reasoning. See `05_AGENT_RUNTIME_AUDIT.md` and `06_EVENT_TRIGGER_SCHEDULER_AUDIT.md`.
4. **The data model measures projects and deals, not company-level goals.** `goals`/`kpis` are foreign-keyed to `project_id`, never to `tenant_id` directly — there is no company-wide Objective/OKR hierarchy anywhere in the schema. See `04_DOMAIN_MODEL_AUDIT.md`.

## 1.4 Multi-tenancy & security posture (summary; full detail in `09_PERMISSION_SECURITY_AUDIT.md`)

Every one of the 53 AI-Company-OS domain tables carries `tenant_id not null references tenants(id)` and has RLS enabled with the generic `is_tenant_member()`/`has_tenant_role()` policy pattern. Application code additionally re-checks `tenant_id` on every sampled `[id]` route (defense in depth, not reliance on RLS alone). `tenant_id` is derived exclusively from the session server-side and is documented as never accepted from a request body/param. OAuth callback has real CSRF/PKCE/single-use-state protection. No committed secrets were found. The two architectural gaps found are a missing cost/spend ceiling and no hard "DENY" tier in the approval-authority model (owner/ceo/admin can always override any configured approval chain).

## 1.5 What "Phase 1-7" actually built, in one paragraph

Phase 1 built the tenant/agent/goal/KPI/task/approval skeleton and a first sales-to-project vertical slice. Phase 3 added a real lead-discovery/scoring/ICP/DNC pipeline. Phase 4 added outreach, reply handling, meeting scheduling, proposals/estimates, negotiation, and contract handoff. Phase 5 added real Gmail/Calendar OAuth connectors, manager-approval routing (`approval_policies`), immutable proposal/estimate versioning, meeting-action-item tracking, PDF/PPTX generation with signed-link file security, and a business-calendar/SLA engine. Phase 7 (the most recent, this session) added the "Growth Loop": splitting delivery into `ready_for_delivery`→human-confirmed `delivered`, then measurement/anomaly-detection/monthly-reporting/contract-renewal/upsell-detection. Every phase is real, tested (291+ vitest tests, all passing per this session's own build logs), and internally consistent — but every phase extended the same fixed-pipeline-plus-human-approval pattern; none of them introduced planning, memory, or scheduling infrastructure.

## 1.6 Where to look for the rest

| Topic | Document |
|---|---|
| Full domain-concept-by-concept mapping | `04_DOMAIN_MODEL_AUDIT.md` |
| Why AI employees stop and wait for humans | `05_AGENT_RUNTIME_AUDIT.md`, `14_ROOT_CAUSE_ANALYSIS.md` |
| Events/cron/scheduling reality | `06_EVENT_TRIGGER_SCHEDULER_AUDIT.md` |
| Memory/knowledge/context engine (or lack of) | `07_MEMORY_KNOWLEDGE_AUDIT.md` |
| What tools are real vs. simulated | `08_TOOL_CONNECTOR_AUDIT.md` |
| Security/permission/authority findings | `09_PERMISSION_SECURITY_AUDIT.md` |
| Full API/DB inventory | `10_DATABASE_API_AUDIT.md` |
| UI classification | `11_UI_AUDIT.md` |
| What to keep/change/discard | `12_KEEP_MODIFY_REPLACE_DELETE.md` |
| The target state and how to get there | `15_TARGET_ARCHITECTURE.md`, `16_MIGRATION_PLAN.md`, `17_VERTICAL_SLICE_PROPOSAL.md` |
