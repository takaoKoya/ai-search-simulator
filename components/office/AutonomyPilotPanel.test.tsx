/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AutonomyPilotPanel from "@/components/office/AutonomyPilotPanel";
import type { AutonomyCockpitState } from "@/lib/server/autonomyCockpit";

// This project does not enable vitest's `globals`, so @testing-library/react's
// own auto-cleanup (which relies on a global `afterEach`) never registers —
// explicit cleanup is required whenever a test file renders more than once.
afterEach(cleanup);

function buildState(): AutonomyCockpitState {
  return {
    settings: {
      tenant_id: "t1",
      feature_enabled: true,
      autonomy_mode: "ASSISTED",
      emergency_stop: false,
      per_execution_cost_limit_usd: null,
      per_cycle_cost_limit_usd: null,
      daily_cost_limit_usd: 10,
      max_works_per_cycle: 1,
      max_tasks_per_work: 10,
      max_cycles_per_objective_per_day: 4,
      max_replans_per_cycle: 1,
      cooldown_after_execution_minutes: 30,
      duplicate_work_window_minutes: 60,
      planner_timeout_seconds: 30,
      execution_timeout_seconds: 300,
    },
    costToday: { reservedUsd: 0, reconciledUsd: 0.05, dailyLimitUsd: 10 },
    objectives: [
      {
        id: "obj-1",
        title: "CVR改善",
        status: "AT_RISK",
        targetValue: 0.05,
        currentValue: 0.01,
        unit: "ratio",
        kpi: { id: "kpi-1", name: "CVR", currentValue: 0.02, targetValue: 0.05 },
        currentCycle: { id: "cyc-1", cycleNumber: 1, status: "COMPLETED" },
        latestPlan: { decision: "CREATE_WORK", reasoningSummary: "KPI is off target", providerKind: "REAL" },
        latestWork: { id: "work-1", title: "Refresh CVR measurement", status: "COMPLETED", authorityDecision: "AUTO" },
        latestVerification: { verdict: "PASS" },
        latestImpact: { classification: "DIRECT_KPI_CHANGE" },
        supervisorDecision: "NEXT_CYCLE",
        pendingApproval: null,
      },
    ],
  };
}

describe("AutonomyPilotPanel", () => {
  it("renders the objective's full pipeline trail without crashing", () => {
    render(<AutonomyPilotPanel initialState={buildState()} role="owner" />);

    expect(screen.getByText("Autonomy Pilot Cockpit")).toBeTruthy();
    expect(screen.getAllByText("CVR改善").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CREATE_WORK").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PASS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DIRECT_KPI_CHANGE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NEXT_CYCLE").length).toBeGreaterThan(0);
    expect(screen.getByText("Emergency Stop")).toBeTruthy();
  });

  it("disables the Emergency Stop toggle for a non-approver role", () => {
    render(<AutonomyPilotPanel initialState={buildState()} role="member" />);
    const button = screen.getByText("Emergency Stop").closest("button");
    expect((button as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it("shows an empty state when there are no objectives yet", () => {
    const state = buildState();
    state.objectives = [];
    render(<AutonomyPilotPanel initialState={state} role="owner" />);
    expect(screen.getByText(/まだObjectiveが登録されていません/)).toBeTruthy();
  });

  it("toggles emergency stop via the API and reflects the new state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, emergencyStop: true }) }))
    );

    render(<AutonomyPilotPanel initialState={buildState()} role="owner" />);
    const button = screen.getByText("Emergency Stop").closest("button")!;
    button.click();

    expect(await screen.findByText("🛑 Emergency Stop: ON")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
