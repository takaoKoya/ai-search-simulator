# 06 — Skill Registry

## 6.1 What a Skill is

`skill_definitions` wraps each of the 18 existing LangGraph pipelines (`lib/langgraph/orchestrator.ts`'s `GraphName` union) as a "Skill" the Autonomy Runtime can reason about and dispatch to, without touching any graph's internals. `executor_ref` (e.g. `"measurement_graph"`) is validated against the `GraphName` TS union at the application layer, deliberately **not** a DB check constraint — adding a 19th graph later needs an app-layer type change and a registry row, never a migration.

## 6.2 The 18 seeded Skills

The migration backfills one row per existing tenant, per graph (and `handle_new_tenant_for_user()` does the same for every new tenant going forward):

| Skill | `executor_ref` | Department | Risk | Approval policy |
|---|---|---|---|---|
| Lead Discovery | `lead_discovery_graph` | sales | LOW | — |
| Lead Generation | `lead_generation_graph` | sales | LOW | — |
| Sales Finalize | `sales_graph` | sales | MEDIUM | `deal_won` |
| Sales Draft | `sales_draft_graph` | sales | LOW | — |
| Sales Outreach Prep | `sales_outreach_prep_graph` | sales | MEDIUM | `sales_send` |
| Reply Analysis | `reply_analysis_graph` | sales | LOW | — |
| Meeting Scheduling | `meeting_scheduling_graph` | sales | LOW | — |
| Meeting Prep | `meeting_prep_graph` | sales | LOW | — |
| Meeting Minutes | `meeting_minutes_graph` | sales | LOW | — |
| Proposal Draft | `proposal_draft_graph` | sales | MEDIUM | — |
| Negotiation Analysis | `negotiation_analysis_graph` | sales | MEDIUM | — |
| Deal Won Gate | `deal_won_gate_graph` | sales | HIGH | `deal_won` |
| Contract Review | `contract_graph` | production | HIGH | — |
| Onboarding | `onboarding_graph` | production | MEDIUM | — |
| Execution | `execution_graph` | production | MEDIUM | — |
| Delivery | `delivery_graph` | production | MEDIUM | `delivery` |
| **Measurement** | **`measurement_graph`** | production | LOW | — |
| **Renewal** | **`renewal_graph`** | production | MEDIUM | — |

Only the bolded two are actually invoked by the PHASE 1 Execution Adapter/Verifier (§6.3) — the rest exist for Registry completeness (spec §11) and are ready for a later phase to widen the Planner's candidate pool onto, with zero schema change required.

## 6.3 Why only 2 of 18 are dispatchable in PHASE 1

`lib/autonomy/executionAdapter.ts::buildGraphInput()` only knows how to build input for `measurement_graph` (`{ projectId }`) and `renewal_graph` (`{ projectId, companyName }`); any other `executor_ref` throws a clear `ValidationError` ("not yet supported") rather than guessing at that graph's input contract — a deliberate, honest scope boundary rather than a half-implemented dispatcher for the other 16.

Both require `objectives.project_id` to be set — discovered mid-implementation, since Objectives (a new, company-level concept) had no way to reference the existing project-scoped work `measurement_graph`/`renewal_graph` operate on. This is why the third migration (`20260927000000_..._objective_project_link.sql`) adds `objectives.project_id` (nullable FK to `projects`) after the fact. `lib/autonomy/verifier.ts` mirrors the same two-skill boundary for its deterministic checks (`checkMeasurementGraph`/`checkRenewalGraph`); anything else returns an `ESCALATE` verdict rather than a false `PASS`/`FAIL`.

## 6.4 SkillCandidateResolver

`lib/autonomy/skillCandidateResolver.ts::resolveCandidateSkills()` — the boundary the Planner sees, never the full Registry:

```
WHERE tenant_id = :tenantId AND enabled = true
  [AND department = :department]     -- optional
LIMIT :limit (default 20)
-- then, in application code:
  [risk_level <= :maxRiskLevel]       -- optional, ranked LOW < MEDIUM < HIGH
```

The query shape (indexed columns, a hard `limit`) — not the filter logic itself — is what keeps this correct at 100/500/1000+ skills later; a synthetic 1000-skill fixture in `skillCandidateResolver.test.ts` proves the `limit` bound holds regardless of registry size.
