# 07 — Memory / Knowledge / Context Engine / "Company Brain" Audit

Read-only audit of `lib/ai/provider.ts`, every `provider.generate()` call site across `lib/langgraph/graphs/*.ts`, a repo-wide grep for memory/knowledge/embedding/vector/RAG/playbook/learning, and `package.json` dependencies.

## 7.1 There is no context-builder module

`AgentTaskContext` (`lib/ai/provider.ts`) is an untyped `{[key: string]: unknown}` bag. The only file with "context" in its name, `lib/langgraph/context.ts`, is **not** a knowledge/context engine — it is graph-run plumbing (`GraphRunCtx` = Supabase client + tenantId + workflowRunId + agentCache, plus `emitEvent`/`createApprovalRequest` helpers). It carries zero business content.

Every one of the 26 `provider.generate()` call sites across the graphs builds its own ad hoc object inline from 1-3 targeted, "latest row" Supabase queries scoped to the one lead/opportunity/project ID in the graph's own state — e.g. `salesDraft.ts` fetches the lead's `company_name` and the single most-recent `lead_sales_hypotheses` row; `meetingPrep.ts` fetches four different tables' latest rows, all for the one lead. **No shared "assemble Company/Department/Employee/Goal/Project/Memory/Knowledge context" function exists anywhere.**

## 7.2 Memory/Knowledge/RAG grep findings

Zero hits anywhere in the repo for: pgvector, an embedding column or model call, a vector index, "RAG", or "playbook". The only real memory-adjacent feature is **`decision_memories`** ("Decision Memory" / "Decision Learning"):

- Table: `id, tenant_id, approval_request_id, category, note, created_by_user_id, rule_candidate (bool)` — append-only (insert/select policies only).
- Written whenever a human rejects/holds/DNCs/edits-and-approves an approval, or from 3 graphs' terminal auto-reject paths.
- `maybeFlagRuleCandidate()` (`lib/server/approvals.ts`): on a sales-lead rejection, counts the tenant's last 30 rejections by industry; if ≥3 share the current industry, flags the row `rule_candidate = true` and emits an event suggesting a human add an exclusion rule. A frequency count over one categorical field — no semantic similarity, no embeddings.
- **Consumption: read only for that same frequency count and for human-facing display in Lead/Opportunity detail panels and the CEO Inbox. It is never read by, or passed into, any `provider.generate()` call.** It is a rejection-reason audit log with one crude repeat-pattern trigger, entirely decoupled from generation.

## 7.3 Package.json confirms zero AI/vector dependencies

Present: `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint` (orchestration/checkpointing only, never an LLM call), `@supabase/supabase-js`, `zod`, `pdfkit`, `pptxgenjs`. **Absent entirely**: `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, any LangChain model/community/vectorstore package, any embeddings or tokenizer package, `pgvector`/`@supabase/vecs`. This matches `lib/ai/provider.ts`'s own doc comment: "Phase 1 intentionally ships only `TemplateProvider`... the interface below is the seam where OpenAI/Claude/Gemini adapters plug in later."

## 7.4 No historical lookback across records

Every graph checked (`salesDraft`, `proposalDraft`, `leadDiscovery`, `meetingPrep`) operates strictly on the specific lead/opportunity/project ID tied to its own run, re-read fresh from Postgres each time. There is no "recall similar past leads/deals" or "check what worked before" capability anywhere. The only cross-record scan in the whole system is the `decision_memories` frequency count above, and it never feeds back into content generation.

## 7.5 No "Company Brain"

`tenants` has exactly four columns: `id, name, slug, created_at`. No `companies`/`settings`/`tenant_settings` table exists. No column anywhere stores mission, values, rules/policy text, or a competitor list. The closest candidates — `service_catalog` (a real per-tenant product/price list) and `departments` (org-chart grouping) — are consumed only by deterministic pricing/UI code, never passed into `provider.generate()` as context, and hold no mission/rules/knowledge content.

## 7.6 No memory-type taxonomy

No short-term/long-term, semantic/episodic/decision distinction exists anywhere, explicit or informal, beyond the single flat "Decision Memory" concept described above. LangGraph checkpoints are per-run execution-resume state, not a memory tier reused across runs. **Verdict: MISSING.**

## 7.7 Overall assessment

This system has no memory or knowledge engine in any meaningful sense — only raw relational rows re-read fresh, scoped narrowly to the one record a workflow is currently processing, plus one narrow, write-mostly audit log that a human reads in the UI and that triggers one crude repeat-pattern counter never fed back into generation. `AgentTaskContext` is a completely untyped bag assembled ad hoc per call site; there is no Company/Department/Employee/Goal/Project context assembly, no retrieval step, no similarity search, no embeddings, and no vector store — confirmed at the code, schema, and dependency level. In short: this is a stateless-per-call template renderer operating on narrowly-scoped fresh DB reads, wrapped in LangGraph purely for workflow orchestration (approvals, retries, status tracking), not for memory, knowledge retrieval, or context engineering.
