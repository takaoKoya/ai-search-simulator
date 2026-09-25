# 02 — Existing Features Inventory

Read-only audit. Evidence sourced from the DB/domain-model, API/route, and agent-runtime research passes (see those documents for file:line citations).

## 2.1 Sales Pipeline (Phase 1 / 3 / 4)

- **Lead intake & discovery**: manual lead creation (`POST /api/leads`); ICP-profile-driven candidate discovery (`POST /api/sales/discovery-runs` → `lead_discovery_graph`): search-strategy generation → candidate discovery (manual or fixture source only, no real web search) → duplicate/DNC exclusion check → basic research → website diagnosis (simulated) → scoring against ICP thresholds → conditional deep research → sales-hypothesis generation → critic review (retry ×3) → human approval.
- **Legacy simpler path**: `POST /api/leads/[id]/start-research` → `lead_generation_graph` (research → strategy → critic → approval), still wired and reachable.
- **Outreach**: `POST /api/leads/[id]/prepare-outreach` → `sales_outreach_prep_graph` (channel selection, draft generation, DNC hard-block, critic with a real rule-checker, human "send" approval). Actual send is a separate, explicitly gated "Final Send Gate" (`POST /api/sales-messages/[id]/send`) with idempotency-key protection.
- **Reply handling**: simulated only — a human pastes a reply (`POST /api/sales-messages/[id]/simulate-reply` → `reply_analysis_graph`); classifies DNC/bounce/auto-reply/meeting-intent, drafts a reply, human approves.
- **Opportunities**: full stage pipeline (candidate → qualified → meeting → negotiation → proposal → won/lost), MEDDIC/BANT-style qualification fields, `deal_won_gate_graph` enforcing preconditions before a "won" approval can even be created.
- **Meetings**: AI-proposed candidate times (deterministic slot heuristic, real Google Calendar free/busy check when connected) → human selects/confirms → real Calendar event creation when connected → transcript paste → AI-drafted minutes → human review, with qualification fields (budget/authority/timing/needs) optionally flowing back into the opportunity.
- **Meeting action items**: AI-suggested candidates (owner/due-date left blank on purpose) → human confirm/reject → convert to a real `tasks` row (requires project to already exist).
- **Proposals & Estimates**: AI-drafted proposal + estimate, critic review with real business-rule checks (margin rate, unmatched services), a "Reconciliation Engine" cross-checking proposal scope against estimate pricing, immutable versioning once APPROVED/SENT/ACCEPTED (DB trigger-enforced), human approval, human "send" gate.
- **Negotiation**: AI logs the client's reaction/negotiation point; never auto-decides a discount — explicitly flagged `requiresCeoJudgment: true`.
- **Contract**: AI contract review → human approval → automatically triggers project onboarding (the one real graph-to-graph auto-chain in the system).

## 2.2 Delivery & Projects (Phase 1 / 7)

- **Onboarding**: creates the `projects` row, staffs a fixed agent roster, generates a fixed task-template list — fully automatic once contract is approved.
- **Execution**: a fixed task-queue drain loop (`execution_graph`) — pulls the next `todo` task, executes it (template-generated), runs a critic ("kuro") then a separate QA agent, loops to the next task; a critic or QA fail blocks the task rather than proceeding.
- **Delivery split (Phase 7)**: `mark_ready_for_delivery` (AI, sets `ready_for_delivery`) is explicitly separate from the human-only "confirm delivery" action (`POST /api/projects/[id]/delivery/confirm`) that actually marks `delivered` and triggers measurement.
- **Files**: real PDF/PPTX generation (pdfkit/pptxgenjs), stored as Postgres `bytea` with SHA-256 checksums and a CLIENT_VISIBLE/INTERNAL classification; in-app authenticated download route + a signed, short-lived, HMAC-verified external share-link route (the only unauthenticated route in the system).

## 2.3 Growth Loop (Phase 7 — most recent)

- **Measurement**: ensures a `measurement_plan` per KPI, advances baseline→collection windows, evaluates effect (SUCCESS/PARTIAL/NO_CHANGE/NEGATIVE/etc. with a confidence score), detects anomalies against warning/critical thresholds, drafts a monthly report, runs critic+QA before allowing a report approval.
- **Renewal**: computes renewal due-status and a GREEN/YELLOW/RED health score from KPI achievement, open issues, missed meetings, sentiment, payment status, and margin.
- **Upsell**: detects candidates when a KPI evaluation comes back NEGATIVE/PARTIAL_SUCCESS, deduplicates against existing opportunities, applies a cooldown, and — on human approval — creates a new `leads`+`opportunities` row to close the loop back into the sales pipeline.
- **Trigger reality**: both `measurement_graph` and `renewal_graph` can be invoked (a) manually by a human (`POST /api/projects/[id]/measure` / `/renew`) or (b) by the `growth-loop-check` cron route sweeping every tenant's `ready_for_delivery`/`delivered` projects — but nothing in this repo currently schedules that cron route (see `06_EVENT_TRIGGER_SCHEDULER_AUDIT.md`).

## 2.4 Approvals & Manager Routing (Phase 1 / 5)

- A single shared `approval_requests` mechanism covers every approval type in the system (sales_lead, sales_send, sales_reply, sales_outreach, proposal_approval, deal_won, contract_approval, delivery, monthly_report, upsell_opportunity).
- Data-driven routing via `approval_policies` (per-tenant, condition-matched: e.g. estimate amount ≥ ¥300,000 requires manager+ceo, discount >5% requires ceo).
- Multi-step chains (`steps` jsonb, `current_step`), SLA due-date/status tracking (business-hours aware), snapshot-hash + expiration to invalidate approvals if the underlying record changed after the request was created.
- Hold / Do-Not-Contact decision paths for sales-adjacent approval types, with a "Decision Learning" heuristic (`decision_memories` + `maybeFlagRuleCandidate`) that flags a human-reviewable "consider an exclusion rule" suggestion after 3+ same-industry rejections in the last 30 — but this never feeds back into generation, only into a UI note.

## 2.5 Integrations (Phase 5)

- **Google OAuth**: real PKCE Authorization Code flow, single-use CSRF state, AES-256-GCM at-rest token encryption, transparent refresh with `needs_reauth` fallback (never retries a dead refresh token forever), proactive refresh via cron.
- **Gmail connector**: real — creates drafts and sends real email via `gmail.googleapis.com` once connected. No read capability implemented despite requesting `gmail.readonly` scope.
- **Google Calendar connector**: real — free/busy check + event creation via `googleapis.com/calendar/v3`. Slot *proposal* is always the deterministic simulated heuristic (interface predates async). No update/delete/list.
- Both connectors transparently fall back to a fully simulated version (network-free, seeded fake IDs) when no real OAuth connection exists for the acting user — this is the default state in this sandbox (no live Google credentials configured).

## 2.6 Business Calendar, SLA & Follow-up Engine (Phase 5)

- Per-tenant working-hours/holiday calendar feeding business-hours-aware SLA due-date math.
- `sla-check` cron recomputes `approval_requests.sla_status` (ON_TRACK/DUE_SOON/BREACHED) — label-only, no notification/escalation action.
- `followup-check` cron creates human-approvable follow-up candidates for stalled outreach — never auto-sends.
- `token-refresh` cron proactively refreshes Google tokens before expiry.
- All four cron routes are real, tested code, gated by a Postgres row-lock (`background_jobs`) against overlapping ticks — but **none of them is currently invoked by anything in this repository** (no `vercel.json`, no other scheduler wiring).

## 2.7 UI Surfaces

- **AI Office (`/office`)**: live, DB-backed dashboard — department rooms, agent cards (status genuinely mirrors the real `agents.status` column), activity feed (every row a real `agent_events` insert), timeline, CEO seat with a computed "minutes to clear" estimate, CEO Inbox (tenant-wide approval queue with SLA/risk/amount context).
- **Lead / Opportunity / Project detail pages**: live, polling their own state endpoints every 5-6s.
- **Settings panels**: ICP profiles, Do-Not-Contact list, Integrations status.
- **Left nav**: 10 items, 5 fully live (Office, WEB運用, Leads, Projects, Approvals), 5 "Coming Soon" placeholders (Clients, Tasks, Reports, Organization, Settings).
- **WebOps Office (`/webops`)**: a separate, 100%-scripted, client-only visual demo of an "AI SNS team" (this session's own recent build) — explicitly documented as touching no backend table; not part of the AI Company OS runtime.

## 2.8 What is conspicuously absent from the feature set

- No company-level Goal/OKR screen or table (goals are project-scoped only).
- No executive/company-wide dashboard (Reports/Organization nav items are placeholders).
- No real web search, browser automation, CRM (the app is its own CRM), ads/analytics API pull, SEO tooling, WordPress, image/video generation, or real social-media posting.
- No memory/knowledge/RAG system of any kind.
- No queue/worker infrastructure and no active scheduler wiring for the cron routes that do exist.
