# 11 — UI Audit (AI Office, Executive Cockpit, WebOps)

Read-only audit of `components/office/**`, `app/office/**`, `components/weboffice/**`, `app/webops/**`. No UI changes made or proposed here.

## 11.1 Component inventory

**AI Office core (live)**: `OfficeApp.tsx` (shell, polls `/api/office/state` every 4s) · `DepartmentRoom.tsx` (prop-driven from OfficeState) · `AgentCard.tsx` (status pill via `getStatusMeta`) · `AgentDrawer.tsx` (own fetch, agent detail) · `Timeline.tsx` (renders real `workflow_runs`/`agent_events`) · `ActivityFeed.tsx` (own comment: "every row is a DB `agent_events` row — nothing here is generated on a timer or randomized") · `Header.tsx`, `IntegrationsPanel.tsx`.

**CEO/Approval (live)**: `CeoInbox.tsx` (receives the tenant-wide `approvals` array as a prop) · `CeoSeatCard.tsx` (a computed "minutes to clear today" figure derived server-side from real historical approval durations, not a hardcoded constant).

**Project/Pipeline (live)**: `ProjectRoom.tsx` (polls every 5s) · `LeadDetail.tsx` (polls every 5s) · `OpportunityDetail.tsx` (polls every 6s) · `SalesSettingsPanel.tsx`.

**WebOps demo (NOT live — explicit exception)**: `app/webops/page.tsx` only checks auth, no other data. `components/weboffice/WebOpsOffice.tsx` (529 lines) is 100% hardcoded/scripted — zero fetch/SWR calls anywhere; state is a local `minute` counter on a `setInterval`, replaying a canned choreography (`lib/weboffice/script.ts`). Visually resembles an "office" but has zero connection to the real backend, DB, or agent runtime.

## 11.2 OfficeState → AgentCard: confirmed genuinely live, not a UI heuristic

`getOfficeState()` queries `agents` directly for `status, current_project_id, current_task_id, ...`; the file's own header comment states "every field here traces back to a DB row written by real agent/workflow/approval activity — nothing is synthesized for display." `AgentCard`'s `getStatusMeta(agent.status)` only translates the DB enum value to a label/icon/color — it does not invent or override the status. The DB check constraint (`agents.status`) and the UI's `AgentStatus` union are byte-for-byte the same 12-value set. **No UI-only heuristic exists at the agent-status level.**

## 11.3 Nav item inventory (`LeftNav.tsx`)

| Item | Coming Soon? | Live? |
|---|---|---|
| Office | No | ✅ Live |
| WEB運用 (webops) | No | Routes to the 100% hardcoded demo — not real backend data |
| Leads | No | ✅ Live |
| Clients | **Yes** | Placeholder |
| Projects | No | ✅ Live |
| Tasks | **Yes** | Placeholder |
| Approvals | No | ✅ Live |
| Reports | **Yes** | Placeholder |
| Organization | **Yes** | Placeholder |
| Settings | **Yes** | Placeholder |

Any click on a "Coming Soon" item pops a toast; **5 of 10 nav items are non-functional placeholders.**

## 11.4 CEO Inbox scope

Genuinely **company/tenant-wide**, not project- or lead-scoped — `getOfficeState()`'s query has no `project_id`/`lead_id` filter, covers every approval type, and surfaces real risk/urgency/SLA/amount context per item (computed server-side, not fabricated). It does not show an aggregate company-wide cost/budget total or cross-approval risk rollup — each figure is local to one approval row.

## 11.5 Project lifecycle stepper vs. DB reality — a real mismatch

`PROJECT_LIFECYCLE` declares 12 stages (`lead, qualified, proposal, won, contract, onboarding, execution, review, ceo_approval, ready_for_delivery, delivered, measurement`) and renders all 12 in the stepper UI. The actual `projects.status` column only has 4 possible values (`active, ready_for_delivery, completed, delivered`). `deriveLifecycleStage()` is a UI-only heuristic that can only ever return 5 of the 12 declared stages (`delivered, ready_for_delivery, review, onboarding, execution`) — the other 7 (`lead, qualified, proposal, won, contract, ceo_approval, measurement`) are declared and rendered but **never reachable for an existing project row within this component's own derivation logic**. This is not fabricated data — each stage corresponds to something real that happened elsewhere (a lead, an opportunity stage, a contract) — but it is a composite UI concept assembled from multiple tables, not backed by a single DB enum, and several of its own listed stages are dead code paths specifically within Project Room's stepper.

## 11.6 No executive/company-wide cockpit exists

No file anywhere under `app/` or `components/` is named or implements "dashboard," "cockpit," or a company-rollup "reports" view. The three most likely candidates for such a screen — **Reports, Organization, Settings** — are all `comingSoon: true` placeholders. The CEO Inbox is the one genuinely company-wide live surface, but it is an approval queue, not a Goals/KPI/workforce/cost overview. **WebOps Office visually resembles what a company-wide view might look like, and should explicitly not be mistaken for one — it is unrelated to the real backend.**

## 11.7 Overall assessment

The AI Office is a solid, genuinely live drill-down system: agents → projects → tasks → approvals, every displayed field traceable to a real DB row, updated by real polling. What does not exist is any single "everything at a glance" executive view combining Goals, KPIs, workforce, tasks, approvals, cost, and risk — that gap is structural (no such component was ever built), not a bug in what exists.
