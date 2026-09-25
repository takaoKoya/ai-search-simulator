# 05 — Agent Runtime / LangGraph / Orchestrator Audit

Read-only audit of all 18 files in `lib/langgraph/graphs/*.ts`, `lib/langgraph/orchestrator.ts`, `lib/langgraph/checkpointer.ts`, `lib/langgraph/context.ts`, and their call sites. This is the single most important document for understanding why AI employees stop and wait for humans — see `14_ROOT_CAUSE_ANALYSIS.md` for the causal chain built on these findings.

## 5.1 Headline finding

**Every one of the 18 graphs is a fixed, human-authored pipeline.** Node order is hardcoded via `.addEdge`/`.addConditionalEdges`; every conditional branch is a deterministic comparison (score threshold, critic PASS/FAIL, precondition checklist, DNC flag, task-queue-empty check) computed by ordinary code — never an LLM/agent call deciding what happens next. No node performs open-ended planning or tool selection.

## 5.2 Graph-by-graph inventory (all 18)

| Graph | Trigger | Fixed nodes | After completion |
|---|---|---|---|
| `lead_discovery_graph` | Human: `POST /api/sales/discovery-runs` | load_icp→strategy→discover→normalize→dup/DNC check→research→website check→score→[HOT/WARM→deep research]→hypothesis→critic(×3)→request_approval | Waits for human |
| `lead_generation_graph` (legacy) | Human: `POST /api/leads/[id]/start-research` | research→strategy→critic→request_approval | Waits for human |
| `sales_graph` | Internal, from `finalizeWonAndStartContract()` (itself only reached via human approval) | finalize_won | Auto-chains to `contract_graph` (same function call) |
| `sales_draft_graph` | Internal, from `applyApproval()` on a "sales_lead" approval | load_context→draft→critic(×3)→finalize | Waits for human (next: prepare-outreach) |
| `sales_outreach_prep_graph` | Human: `POST /api/leads/[id]/prepare-outreach` | load research→[DNC stop]→select channel→draft→critic(×3)→request send approval | Waits for human ("Final Send Gate" is a separate human action) |
| `reply_analysis_graph` | Human: `POST /api/sales-messages/[id]/simulate-reply` (no real inbox polling) | record→classify→[DNC/skip branches]→meeting-conversion check→draft reply→critic(×3)→request approval | Waits for human |
| `meeting_scheduling_graph` | Human: `POST /api/opportunities/[id]/meetings` | propose_times only | Completes immediately; confirmation is a separate human action |
| `meeting_prep_graph` | Human: `POST /api/meetings/[id]/prep` | generate_prep only, no critic | Completes; no auto-chain |
| `meeting_minutes_graph` | Human: `POST /api/meetings/[id]/minutes` | generate_minutes only, no critic | Waits for human confirm |
| `proposal_draft_graph` | Human: `POST /api/opportunities/[id]/proposals` | check triggers→draft proposal→draft estimate→critic(×3, real rule-checker + reconciliation)→request approval | Waits for human |
| `negotiation_analysis_graph` | Human: `POST /api/opportunities/[id]/negotiation-items` | analyze_reaction only, no critic | Completes; flagged `requiresCeoJudgment: true` |
| `deal_won_gate_graph` | Human: `POST /api/opportunities/[id]/won` | check_won_conditions only | Waits for human, or stops entirely if checklist unmet |
| `contract_graph` | Internal, from `finalizeWonAndStartContract()` | contract_review→request_approval | Waits for human; approval auto-runs `onboarding_graph` |
| `onboarding_graph` | Internal, from `applyApproval()` on "contract_approval" | create_project→form_team→create_tasks | **Auto-chains to `execution_graph` — the one true graph→graph chain with zero human click in between (hardcoded `if` in orchestrator)** |
| `execution_graph` | Internal, chained from `onboarding_graph` | next_task→execute_task→critic_task→qa_task→loop (fixed queue-drain, not dynamic planning) | Waits for human ("delivery" approval); approval auto-runs `delivery_graph` |
| `delivery_graph` | Internal, from `applyApproval()` on "delivery" | mark_ready_for_delivery only | Completes; actual hand-to-client is a separate human action |
| `measurement_graph` | Human (`POST /api/projects/[id]/measure`) or cron (`growth-loop-check`) | ensure plans→advance→collect & evaluate→draft report→critic+QA | Waits for human on the report |
| `renewal_graph` | Human (`POST /api/projects/[id]/renew`) or cron | check renewal due→detect upsell | Waits for human on any upsell candidate |

## 5.3 Orchestrator analysis

`lib/langgraph/orchestrator.ts::runBusinessGraph` is **a dispatcher, not a planner**: `invokeGraph()` is a literal `switch` over 18 hardcoded graph-name string literals. There is no logic that inspects tenant/business state and chooses which graph to run — the caller (an API route or `applyApproval`) always specifies exactly which graph runs. Its only behavior beyond dispatch: (a) creates/updates a `workflow_runs` row, (b) emits lifecycle events, (c) **one hardcoded auto-chain**: `onboarding_graph` completing → immediately runs `execution_graph`, documented in the orchestrator's own docstring as "chains the next segment when a phase completes without pausing for human approval (today: onboarding → execution)." `resumeBusinessGraph` is a separate crash-recovery function (resumes the *same* graph from its last checkpoint), not a router either.

## 5.4 Checkpointer & state-machine findings

`SupabaseCheckpointSaver` persists full LangGraph state to `workflow_checkpoints`/`workflow_checkpoint_writes`, plus a top-level `workflow_runs` row with the full final state. An agent's exact state at any checkpoint is genuinely reconstructable (used for real crash recovery).

**There is no single unified status machine.** ~25 distinct, entity-scoped status vocabularies were found (GraphStatus, `agents.status`, `agent_runs.status`, `leads.status`, `leads.discovery_stage` — a *second*, separately-maintained lead status column, `opportunities.status`+`stage`, `contracts.status`, `projects.status`, `tasks.status`, `deliverables.status`, `approval_requests.status`+`sla_status`, `sales_drafts.status`, `sales_messages.status`, `critic_status`, `meetings.status`+`transcript_status`+`minutes_status`, `meeting_action_items.status`, `proposals.status`, `estimates.status`, `measurement_plans.status`, `anomaly_events.severity`, `reporting_cycles.status`, `monthly_reports.status`, `contract_renewals.status`+`risk_level`, `upsell_opportunities.status`). The richest — `agents.status` (idle/queued/thinking/working/tool_calling/waiting_external/waiting_human/reviewing/handoff/completed/warning/failed) — is schema-only for 9 of its 12 values: runtime code only ever sets `working`, `idle`, or `failed`.

## 5.5 Verification findings

12 of 18 graphs have a critic/QA gate before allowing an approval; a FAIL routes back to regenerate (capped at 3) rather than proceeding. Two graphs (`salesOutreachPrep`, `proposalDraft`) use genuinely independent, hand-written deterministic rule-checkers (DNC hard-block; margin-rate/unmatched-service/proposal↔estimate reconciliation checks) — real business-rule enforcement, not self-report. `execution_graph`'s task loop has a real two-stage gate (critic agent + separate QA agent; either failing blocks the task). The remaining critics in most graphs are `provider.generate("critic_review", ...)` — the *same* deterministic `TemplateProvider` grading its own output, not an independent evaluator. 5 graphs (meeting scheduling/prep/minutes, negotiation analysis) have **no** critic/QA node at all and mark themselves "completed" on write, relying entirely on a downstream human review step to catch problems.

## 5.6 Retry / failure findings

The only retry loop anywhere is the critic-driven regenerate loop (capped at 3), present in 5 graphs. There is **no retry of infrastructure failures** (every Supabase call does `if (error) throw`, zero backoff), **no alternative-tool fallback**, and **no automated human escalation** on failure — a thrown error propagates and `workflow_runs.status` is set to `'failed'`; a human might later notice it in the UI. The cron sweep (`growth-loop-check`) wraps each project in try/catch so one failure doesn't abort the whole tenant sweep — "log and continue," not retry or escalate.

## 5.7 Multi-agent communication findings

No graph file imports another graph's builder directly. All cross-graph coordination goes through the orchestrator's dispatch, triggered by a human API call, a cron route, or `applyApproval()` (itself only reached via a human decision). "Handoffs" within a graph are `agent_events` narration rows, not function calls from one agent into another. No circularity risk was found; both auto-chains identified (`onboarding→execution`, `sales→contract`) are one-directional and terminate.

## 5.8 Observability findings

`workflow_run_id` links `agent_runs`, `agent_events`, and `workflow_checkpoints` well *within one graph invocation* — you can fully reconstruct why one graph run did what it did. But **no ID spans a whole business case across multiple graphs**: a single lead's journey from discovery through delivery touches 6-7 separate `workflow_runs` rows, each with its own ID, linked only implicitly by the changing identity of the underlying record (lead→opportunity→contract→project). No `trace_id`/`execution_id` distinct from `workflow_run_id` exists.

## 5.9 The one sentence that answers the audit's central question

**There is exactly one case in this entire codebase where completing one graph automatically triggers another graph's execution with zero human action or cron tick in between** (`onboarding_graph → execution_graph`, a single hardcoded `if` in `orchestrator.ts`) — and even that is a fixed, human-authored control-flow rule, not an agent reasoning about state. No LLM/agent call anywhere determines which node, which graph, or which business action comes next.
