"use client";

import { useState } from "react";
import type { AutonomyCockpitState } from "@/lib/server/autonomyCockpit";
import type { TenantRole } from "@/lib/server/tenant";

const APPROVER_ROLES: TenantRole[] = ["owner", "ceo", "admin"];

const GOOD = new Set(["COMPLETED", "PASS", "AUTO", "ACTIVE", "ACHIEVED", "DIRECT_KPI_CHANGE", "NEXT_CYCLE", "COMPLETE"]);
const BAD = new Set(["FAILED", "FAIL", "DENY", "DENIED", "ESCALATE", "ESCALATED", "AT_RISK", "BLOCKED", "BLOCK"]);

function statusColor(value: string | null | undefined): string {
  if (!value) return "var(--office-text-muted)";
  if (GOOD.has(value)) return "var(--office-status-completed)";
  if (BAD.has(value)) return value === "AT_RISK" ? "var(--office-status-warning)" : "var(--office-status-failed)";
  return "var(--office-status-warning)";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
        {label}
      </p>
      <div className="mt-0.5 text-[13px]" style={{ color: "var(--office-text-primary)" }}>
        {children}
      </div>
    </div>
  );
}

function Pill({ value }: { value: string | null | undefined }) {
  if (!value) return <span style={{ color: "var(--office-text-muted)" }}>—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `color-mix(in srgb, ${statusColor(value)} 18%, transparent)`, color: statusColor(value) }}
    >
      {value}
    </span>
  );
}

/**
 * Minimum Pilot Cockpit (spec §17/UI) — a Runtime-State projection, exactly
 * like the rest of AI Office: every field here is read directly from
 * autonomy_cycles/works/verifications/impact_assessments/decision_logs by
 * lib/server/autonomyCockpit.ts, never a second state store (spec FINAL
 * CHANGE 2). No large redesign — this is one panel, one page.
 */
export default function AutonomyPilotPanel({ initialState, role }: { initialState: AutonomyCockpitState; role: TenantRole }) {
  const [state, setState] = useState(initialState);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canToggleEmergencyStop = APPROVER_ROLES.includes(role);
  const settings = state.settings;

  async function toggleEmergencyStop() {
    if (!settings) return;
    setToggling(true);
    setError(null);
    try {
      const res = await fetch("/api/autonomy/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emergencyStop: !settings.emergency_stop }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to toggle emergency stop");
      setState((prev) => (prev.settings ? { ...prev, settings: { ...prev.settings, emergency_stop: data.emergencyStop as boolean } } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle emergency stop");
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border p-4" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
        <div>
          <h1 className="text-[16px] font-bold" style={{ color: "var(--office-text-primary)" }}>
            Autonomy Pilot Cockpit
          </h1>
          <p className="mt-1 text-[12px]" style={{ color: "var(--office-text-secondary)" }}>
            Autonomy Mode: <Pill value={settings?.autonomy_mode ?? null} /> {settings && !settings.feature_enabled && <span style={{ color: "var(--office-text-muted)" }}> (feature disabled)</span>}
          </p>
        </div>
        <button
          onClick={toggleEmergencyStop}
          disabled={!canToggleEmergencyStop || !settings || toggling}
          className="rounded-lg border px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: settings?.emergency_stop ? "var(--office-status-failed)" : "var(--office-border)",
            background: settings?.emergency_stop ? "color-mix(in srgb, var(--office-status-failed) 18%, transparent)" : "transparent",
            color: settings?.emergency_stop ? "var(--office-status-failed)" : "var(--office-text-primary)",
          }}
        >
          {settings?.emergency_stop ? "🛑 Emergency Stop: ON" : "Emergency Stop"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--office-status-failed)", background: "color-mix(in srgb, var(--office-status-failed) 10%, transparent)", color: "var(--office-status-failed)" }}>
          {error}
        </div>
      )}

      {state.costToday && (
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
          <Field label="Cost (today)">
            <span>
              予約 ${state.costToday.reservedUsd.toFixed(2)} + 確定 ${state.costToday.reconciledUsd.toFixed(2)}
              {state.costToday.dailyLimitUsd != null && <span style={{ color: "var(--office-text-muted)" }}> / 上限 ${state.costToday.dailyLimitUsd.toFixed(2)}</span>}
            </span>
          </Field>
        </div>
      )}

      {state.objectives.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-[13px]" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)", color: "var(--office-text-muted)" }}>
          まだObjectiveが登録されていません。
        </div>
      ) : (
        state.objectives.map((objective) => (
          <div key={objective.id} className="rounded-xl border p-4" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-bold" style={{ color: "var(--office-text-primary)" }}>
                {objective.title}
              </h2>
              <Pill value={objective.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="KPI">
                {objective.kpi ? (
                  <span>
                    {objective.kpi.name ?? "—"}: {objective.kpi.currentValue ?? "—"} / {objective.kpi.targetValue ?? "—"}
                  </span>
                ) : (
                  <span style={{ color: "var(--office-text-muted)" }}>未連携</span>
                )}
              </Field>
              <Field label="Current Cycle">{objective.currentCycle ? <span>#{objective.currentCycle.cycleNumber}</span> : <span style={{ color: "var(--office-text-muted)" }}>—</span>}</Field>
              <Field label="State">
                <Pill value={objective.currentCycle?.status} />
              </Field>
              <Field label="Provider Mode">
                <Pill value={objective.latestPlan?.providerKind} />
              </Field>
              <Field label="Plan">
                {objective.latestPlan ? (
                  <>
                    <Pill value={objective.latestPlan.decision} />
                    <p className="mt-1 text-[11px]" style={{ color: "var(--office-text-secondary)" }}>
                      {objective.latestPlan.reasoningSummary}
                    </p>
                  </>
                ) : (
                  <span style={{ color: "var(--office-text-muted)" }}>—</span>
                )}
              </Field>
              <Field label="Work">{objective.latestWork ? <span>{objective.latestWork.title}</span> : <span style={{ color: "var(--office-text-muted)" }}>—</span>}</Field>
              <Field label="Execution">
                <Pill value={objective.latestWork?.status} />
              </Field>
              <Field label="Verification">
                <Pill value={objective.latestVerification?.verdict} />
              </Field>
              <Field label="Impact">
                <Pill value={objective.latestImpact?.classification} />
              </Field>
              <Field label="Supervisor Decision">
                <Pill value={objective.supervisorDecision} />
              </Field>
              <Field label="Approval">
                {objective.pendingApproval ? <span style={{ color: "var(--office-status-warning)" }}>承認待ち: {objective.pendingApproval.title}</span> : <span style={{ color: "var(--office-text-muted)" }}>—</span>}
              </Field>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
