# 09 — 2-Cycle Vertical Slice

PHASE 1 is not considered proven by a single successful execution (spec CHANGE 8/§13). The required proof is `lib/autonomy/closedLoop.integration.test.ts`, which reproduces two full cycles of the same Objective and asserts Cycle 2 reaches a **genuinely different** Planner decision than Cycle 1, driven by different (scripted) inputs — not a hardcoded second outcome.

## 9.1 Test technique

- `ASSISTED` autonomy mode with a mocked global `fetch` (not `SHADOW`+`MockLLMProvider`) — the actual `getLLMProvider()` codepath offers no way to inject a custom Mock responder into `planForCycle()`'s real call path; scripting the Anthropic HTTP response is the faithful equivalent of controlling exactly what each cycle's real Planner call returns, without touching production code to add a test-only seam.
- `runBusinessGraph` is `vi.mock()`-ed (this codebase's first use of `vi.mock()` — justified since exercising the real `measurement_graph` here is out of scope; that graph's own correctness is already covered by `growthLoop.integration.test.ts`).
- Both cycles run through the real, unmodified `runObjectiveCycle()` — no cycle-specific test shortcut.

## 9.2 Cycle 1

| Stage | Result |
|---|---|
| Observer | `autonomy_cycles` row #1 created (`cycle_number=1`); KPI (0.01 vs target 0.05, below `critical_threshold`) → `requires_planning=true` |
| Planner | Scripted Anthropic response: `CREATE_WORK`, one `proposedWork` against the seeded `measurement_graph` skill |
| Authority | No `approval_policy_code` on the skill → `AUTO` |
| Execution | `runBusinessGraph()` mocked to `{status:"completed"}`; a `kpi_snapshots` row is pre-seeded to represent what the graph would have written |
| Verify | `CURRENT_KPI_SNAPSHOT_EXISTS`/`SNAPSHOT_VALUE_PRESENT` both pass → `PASS` |
| Impact | Two CURRENT snapshots differ (0.01 → 0.02) → `DIRECT_KPI_CHANGE` |
| Supervisor | Objective's *pre-cycle* status is still `AT_RISK` (Observer only re-evaluates on its next pass — this staleness is exactly what makes `NEXT_CYCLE` meaningful) → `NEXT_CYCLE` → cycle transitions to `COMPLETED` |

## 9.3 Cycle 2

Run again with `now` two hours later (cooldown is 0 in the test fixture). Observer creates cycle #2, `parent_cycle_id` pointing at cycle #1's id. A **second, different** scripted Anthropic response drives the Planner to `WAIT` this time ("The metric moved in the right direction after Cycle 1's execution; waiting one more observation window"). No Work is created, `runBusinessGraph()` is not called again (asserted `toHaveBeenCalledTimes(1)` — i.e. only Cycle 1's call), and the Supervisor reaches `COMPLETE` — asserted explicitly as a **successful**, not failed, outcome.

## 9.4 What the test proves, concretely

- `fake.table("autonomy_cycles")` has exactly 2 rows; cycle 2's `parent_cycle_id === cycle1.cycleId`, `cycle_number === 2` — a genuinely new row, never a reopened/looped one (`04_STATE_MACHINE.md §4.2`).
- `cycle1Plan.decision !== cycle2Plan.decision` (`CREATE_WORK` vs `WAIT`) — the two cycles' decisions are asserted unequal, not merely present.
- `decision_logs` for cycle 1 include all seven stages (`OBSERVE, PLAN, AUTHORIZE, EXECUTE, VERIFY, ASSESS_IMPACT, SUPERVISE`); cycle 2's logs include only `OBSERVE, PLAN, SUPERVISE` — no `EXECUTE` entry at all for cycle 2, directly verifying "no execution happened this cycle" at the audit-trail level, not just via a return-value assertion.
- `works` table has exactly 1 row total across both cycles — Cycle 2 created no new Work.

## 9.5 Relationship to the pilot rollout

This integration test is the artifact that proves the design; `11_OPERATIONS.md §11.3` covers running the same shape of loop against a real pilot tenant (Shadow → Assisted), which additionally requires the three migrations to be applied to a live Postgres instance and `ANTHROPIC_API_KEY` to be configured (`05_PLANNER.md §5.4`) before `ASSISTED`/`ACTIVE` mode can run at all.
