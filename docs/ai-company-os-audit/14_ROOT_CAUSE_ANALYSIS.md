# 14 — Root Cause Analysis: Why Human Instruction Is Required Every Time

Format: SYMPTOM → DIRECT CAUSE → ARCHITECTURAL CAUSE → ROOT CAUSE → REQUIRED CHANGE. Each chain is traced through actual code/schema evidence cited in the numbered audit documents — none of this is speculative.

## Chain 1 — Why doesn't the AI ever decide, on its own, that new work needs to happen?

- **SYMPTOM**: Of 18 LangGraph pipelines, 16 start only from a human clicking something; the other 2 start from an unwired cron route. Exactly one graph→graph auto-chain exists with zero human action (`onboarding→execution`), and it is a single hardcoded `if`, not a decision.
- **DIRECT CAUSE**: `runBusinessGraph()` is a plain dispatcher — it requires the caller to already know and supply the exact `graphName` to run. No code anywhere inspects company state and picks a graph name itself.
- **ARCHITECTURAL CAUSE**: There is no Planner/Goal-Engine component in the architecture at all. The orchestration layer was designed purely as "run this one named pipeline correctly and durably," never as "given the company's current state, decide what should run."
- **ROOT CAUSE**: The domain model has no company-level Goal or Objective — `goals`/`kpis` are foreign-keyed to `project_id` only (`04_DOMAIN_MODEL_AUDIT.md` #9-11). There is nothing for a Planner to plan *against* even if one existed. Each of the 7 build phases was scoped as "automate this one manual step a human currently does" (research a lead, draft a proposal, measure a KPI), never as "give the AI a standing company objective and let it find the next gap." Planning was never a requirement, because nothing in the model represents what the company is trying to achieve as a whole.
- **REQUIRED CHANGE**: Add a tenant-level `objectives` table with KPI targets; add a Planner that runs on a schedule/event, compares Goal vs. actual, and creates Work/Task rows (or invokes a specific graph) when a gap is found. See `17_VERTICAL_SLICE_PROPOSAL.md` for the minimal version of this.

## Chain 2 — Why doesn't the one cron route capable of scheduled autonomy ever actually run?

- **SYMPTOM**: `growth-loop-check` (the only route that can run `measurement_graph`/`renewal_graph` without a human) never executes on its own in this deployment.
- **DIRECT CAUSE**: No `vercel.json` or any other scheduler configuration exists anywhere in the repository.
- **ARCHITECTURAL CAUSE**: Scheduling was treated as a deployment-time concern to be configured *outside* the codebase "later" — the README itself instructs a human operator to go schedule it, rather than the repo declaring its own schedule as code.
- **ROOT CAUSE**: Every phase's definition of "done" was "graph + route + UI + tests," and trigger-wiring was implicitly assumed to be someone else's job (ops/deployment) — so it fell through every one of the 7 phases without ever being anyone's explicit deliverable.
- **REQUIRED CHANGE**: Check a scheduling config into the repo itself (Vercel Cron `crons` block or equivalent) as a first-class artifact, and add a health check that fails loudly if a cron route hasn't fired within its expected interval.

## Chain 3 — Why does "verification" sometimes amount to self-report?

- **SYMPTOM**: 5 of 18 graphs mark themselves "completed" with no critic/QA node at all; most of the rest use the same `TemplateProvider` to grade its own `TemplateProvider` output — only 2 graphs use an independent, hand-written rule-checker.
- **DIRECT CAUSE**: The critic pattern was hand-built with real business rules for the two highest-risk pipelines (outreach send, proposal), then generalized to the rest via the generic `provider.generate("critic_review", ...)` call instead of a dedicated checker per pipeline.
- **ARCHITECTURAL CAUSE**: There is no distinct "Verifier" architectural role — verification is implemented as just another `AIProvider` task type, so it inherits the exact same blind spots as the content it's supposed to be checking.
- **ROOT CAUSE**: `lib/ai/provider.ts`'s interface design treats "verify" as a content-generation task, not a structurally different capability (schema check / business-rule engine / independent judge). This is an interface-level gap, not a collection of unrelated per-graph bugs — the same fix applies everywhere at once.
- **REQUIRED CHANGE**: Introduce a distinct `Verifier` interface (deterministic schema + business-rule checks first; an independent LLM-based judge only once a real LLM provider exists) and require every graph's terminal "mark done" transition to pass through it, not through `TemplateProvider` again.

## Chain 4 — Why is there no company-wide "is everything OK" view?

- **SYMPTOM**: No Executive Cockpit exists; the three most likely nav slots (Reports, Organization, Settings) are all "Coming Soon" placeholders.
- **DIRECT CAUSE**: No component or aggregation query was ever built for it.
- **ARCHITECTURAL CAUSE**: Every backend aggregation function that exists (`getOfficeState`, `getProjectRoomState`, `getOpportunityDetailState`) is scoped to one entity (one tenant's agent roster, one project, one opportunity) — there is no cross-project, company-level rollup query anywhere in `lib/server`.
- **ROOT CAUSE**: Same as Chain 1 — because there is no company-level Goal/KPI, there is nothing *at the company level* to roll up into a cockpit yet. Building the screen before the company-level data exists would just be another per-project view wearing a different skin.
- **REQUIRED CHANGE**: Build the company-level Objective/Goal/KPI model (Chain 1's fix) first; the Executive Cockpit then becomes a straightforward aggregation view over data that finally exists at that level.

## Chain 5 — Why doesn't the system learn from what it gets rejected for?

- **SYMPTOM**: `decision_memories.rule_candidate` correctly flags a real repeat-rejection pattern, but nothing acts on the flag automatically, and it is never fed back into any generation call.
- **DIRECT CAUSE**: No downstream `rules`/`playbooks` table or consuming code exists to receive a promoted flag.
- **ARCHITECTURAL CAUSE**: `decision_memories` was scoped narrowly, as a rejection-reason audit trail with one bolted-on frequency counter — not as part of a general Learning subsystem.
- **ROOT CAUSE**: "Learning" has no domain-model representation anywhere (confirmed `MISSING` in `04_DOMAIN_MODEL_AUDIT.md`). The `rule_candidate` boolean was added speculatively — "this might feed a rules system someday" — without that rules system ever being scoped in the same phase, so it necessarily stalled at the flag stage.
- **REQUIRED CHANGE**: Either finish the loop (a human "promote to rule" action that writes an actual, consultable exclusion/preference rule a future `lead_discovery_graph` run reads) or explicitly remove the half-built flag. Per this audit's own KEEP/MODIFY/REPLACE/DELETE discipline, a half-finished speculative field should be completed or cut — not left dangling indefinitely.

## Chain 6 — Why can't a tenant enforce "no single person may approve a large discount alone"?

- **SYMPTOM**: `owner`/`ceo`/`admin` can always single-handedly decide any approval, regardless of the multi-step chain `approval_policies` configured for it.
- **DIRECT CAUSE**: `authorizeDecision()` has an unconditional superuser-role bypass evaluated before the configured step chain is even consulted.
- **ARCHITECTURAL CAUSE**: The approval model has exactly one dimension — "which role must act" — with no separate concept of a hard block or an "N distinct people must independently agree" control.
- **ROOT CAUSE**: `approval_policies` was built in Phase 5 to solve a routing problem ("send this to the right role"), not a control problem ("this specific action must never happen without two independent humans"). The two requirements are related but distinct, and only the first was in scope when this table was designed.
- **REQUIRED CHANGE**: Extend `approval_policies` with an explicit control-strength field (e.g. `require_distinct_approvers`, `hard_deny`) and make the superuser bypass a per-policy, separately-audited override rather than a blanket rule.

## 14.1 Root causes ranked by how much of the audit's central question they explain

1. **No company-level Goal/Objective in the data model** (Chains 1 & 4) — the deepest cause; nearly everything else in this list is downstream of "there is nothing at the company level for an autonomy loop to run against."
2. **No Planner/Goal-Engine component exists at any layer** (Chain 1) — the architectural gap that makes fixing #1 alone insufficient without also adding a consumer of that data.
3. **Scheduling exists in code but was never wired into the deployment** (Chain 2) — the cheapest fix on this entire list, and the one most likely to feel like "why hasn't this just been done."
4. **Verification is architecturally the same capability as generation** (Chain 3) — a design flaw that will keep reproducing "self-graded homework" every time a new pipeline is added, until fixed once at the interface level.
5. **No Supervisor role separate from the executing graph** (see `05_AGENT_RUNTIME_AUDIT.md` §5.5, §5.7) — verification and execution currently share the same deterministic engine within one run.
6. **Learning was scoped as a single speculative flag, never as a subsystem** (Chain 5).
7. **The approval-authority model conflates routing with control** (Chain 6).
8. **No memory/context engine exists to give any of the above a place to accumulate what the company has learned** (`07_MEMORY_KNOWLEDGE_AUDIT.md`) — even if Chains 1-2 were fixed today, decisions made by a future Planner would still have no history to draw on.
9. **No cost/budget ceiling exists to bound what an autonomous loop is allowed to spend** (`09_PERMISSION_SECURITY_AUDIT.md` §9.8) — a prerequisite for safely turning on any of the above, not just a nice-to-have.
10. **Cross-graph observability lacks a unifying case ID** (`05_AGENT_RUNTIME_AUDIT.md` §5.8) — without this, a future Supervisor cannot reason about "how is this one deal/client doing end to end," only about individual graph runs.
