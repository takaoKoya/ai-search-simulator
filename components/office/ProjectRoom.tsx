"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { ProjectRoomState } from "@/lib/server/projectRoom";
import { PROJECT_LIFECYCLE, type ProjectLifecycleStage } from "@/lib/server/projectRoom";
import type { TenantRole } from "@/lib/server/tenant";
import { getStatusMeta } from "@/lib/office/status";
import AgentDrawer from "@/components/office/AgentDrawer";
import Timeline from "@/components/office/Timeline";

const LIFECYCLE_LABEL: Record<ProjectLifecycleStage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  contract: "Contract",
  onboarding: "Onboarding",
  execution: "Execution",
  review: "Review",
  ceo_approval: "CEO Approval",
  delivered: "Delivered",
  measurement: "Measurement",
};

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "未着手",
  in_progress: "進行中",
  in_review: "レビュー中",
  qa: "QA中",
  done: "完了",
  blocked: "ブロック",
};

const POLL_INTERVAL_MS = 5000;

export default function ProjectRoom({
  projectId,
  initialState,
  role,
}: {
  projectId: string;
  initialState: ProjectRoomState;
  role: TenantRole;
}) {
  const [state, setState] = useState(initialState);
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const inFlight = useRef(false);
  const canApprove = role === "owner" || role === "ceo" || role === "admin";

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/projects/${projectId}/room`);
      if (res.ok) setState(await res.json());
    } finally {
      inFlight.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function decide(approvalId: string, action: "approve" | "reject" | "revise", withReason?: string) {
    if (!canApprove) {
      setToast("この操作にはCEO/管理者権限が必要です");
      return;
    }
    const res = await fetch(`/api/approvals/${approvalId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: withReason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast(body.error ?? "エラーが発生しました");
      return;
    }
    setReasonFor(null);
    setReason("");
    await refresh();
  }

  const { project, team, tasks, goals, kpis, findings, approvals, deliverables, workflowRuns, events, progress, deliveryGate } = state;
  const currentStageIndex = PROJECT_LIFECYCLE.indexOf(project.lifecycleStage);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  return (
    <div className="ai-office min-h-screen bg-[var(--office-bg-primary)] text-[var(--office-text-primary)]">
      <header
        className="flex h-16 items-center gap-4 border-b px-4"
        style={{ borderColor: "var(--office-border)", background: "color-mix(in srgb, var(--office-bg-secondary) 85%, transparent)" }}
      >
        <Link href="/office" className="text-xs font-semibold" style={{ color: "var(--office-ai-accent)" }}>
          ← AI Office
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold">{project.name}</h1>
          <p className="truncate text-[11px]" style={{ color: "var(--office-text-muted)" }}>
            {project.client?.name ?? "クライアント未設定"}
          </p>
        </div>
      </header>

      {toast && (
        <div
          className="fixed right-4 top-20 z-50 rounded-lg border px-4 py-2 text-sm shadow-lg"
          style={{ borderColor: "var(--office-status-failed)", background: "var(--office-bg-secondary)", color: "var(--office-status-failed)" }}
        >
          {toast}
        </div>
      )}

      {/* Lifecycle stepper */}
      <div className="overflow-x-auto border-b px-4 py-3" style={{ borderColor: "var(--office-border)" }}>
        <ol className="flex min-w-max items-center gap-1.5">
          {PROJECT_LIFECYCLE.map((stage, idx) => {
            const isCurrent = idx === currentStageIndex;
            const isPast = idx < currentStageIndex;
            return (
              <li key={stage} className="flex items-center gap-1.5">
                <span
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{
                    background: isCurrent ? "var(--office-ai-accent)" : isPast ? "color-mix(in srgb, var(--office-ai-accent) 20%, transparent)" : "var(--office-surface)",
                    color: isCurrent ? "#04121f" : isPast ? "var(--office-ai-accent)" : "var(--office-text-muted)",
                  }}
                >
                  {LIFECYCLE_LABEL[stage]}
                </span>
                {idx < PROJECT_LIFECYCLE.length - 1 && (
                  <span style={{ color: "var(--office-border)" }} aria-hidden>
                    →
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
        <main className="space-y-4">
          {/* Goal / KPI */}
          <Section title="Goal / KPI">
            {goals.length === 0 && kpis.length === 0 ? (
              <EmptyState message="Goal/KPIはまだ設定されていません。" />
            ) : (
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                {goals.map((g) => (
                  <div key={g.id}>
                    <p style={{ color: "var(--office-text-muted)" }}>Goal</p>
                    <p>
                      {g.title} {g.target_value ? `(目標 ${g.target_value}${g.unit ?? ""})` : ""}
                    </p>
                  </div>
                ))}
                {kpis.map((k) => (
                  <div key={k.id}>
                    <p style={{ color: "var(--office-text-muted)" }}>KPI: {k.name}</p>
                    <p>
                      {k.current_value ?? "—"} / {k.target_value ?? "—"} {k.unit ?? ""}
                      {k.measured_at && (
                        <span className="ml-2" style={{ color: "var(--office-text-muted)" }}>
                          最終測定: {new Date(k.measured_at).toLocaleDateString("ja-JP")}
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Team */}
          <Section title="Project Team">
            {team.length === 0 ? (
              <EmptyState message="まだAI Teamが編成されていません。" />
            ) : (
              <ul className="flex flex-wrap gap-2">
                {team.map((member) => {
                  const agent = member.agent as { id: string; name: string; job_title: string | null; status: string } | null;
                  if (!agent) return null;
                  const meta = getStatusMeta(agent.status);
                  return (
                    <li key={member.id}>
                      <button
                        onClick={() => setDrawerAgentId(agent.id)}
                        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]"
                        style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(${meta.colorVar})` }} aria-hidden />
                        <span className="font-semibold">{agent.name}</span>
                        <span style={{ color: "var(--office-text-muted)" }}>{agent.job_title ?? member.roleInProject}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Current workflow */}
          <Section title="Current Workflow">
            {workflowRuns.length === 0 ? (
              <EmptyState message="ワークフローの実行はまだありません。" />
            ) : (
              <ul className="space-y-1 text-[12px]">
                {workflowRuns.slice(0, 6).map((w) => (
                  <li key={w.id} className="flex items-center justify-between">
                    <span>
                      {w.graph_name} {w.current_node ? `・ ${w.current_node}` : ""}
                    </span>
                    <span
                      style={{
                        color:
                          w.status === "completed"
                            ? "var(--office-status-completed)"
                            : w.status === "waiting_human"
                              ? "var(--office-status-waiting-human)"
                              : w.status === "failed"
                                ? "var(--office-status-failed)"
                                : "var(--office-status-thinking)",
                      }}
                    >
                      {w.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Tasks */}
          <Section title={`Tasks (${progress.doneTasks}/${progress.totalTasks})`}>
            {tasks.length === 0 ? (
              <EmptyState message="Taskはまだ生成されていません。" />
            ) : (
              <ul className="space-y-1.5 text-[12px]">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--office-border)" }}>
                    <span>{t.title}</span>
                    <span
                      style={{
                        color:
                          t.status === "done"
                            ? "var(--office-status-completed)"
                            : t.status === "blocked"
                              ? "var(--office-status-failed)"
                              : "var(--office-text-secondary)",
                      }}
                    >
                      {TASK_STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Findings */}
          <Section title="Findings">
            {findings.length === 0 ? (
              <EmptyState message="Findingはまだありません。" />
            ) : (
              <ul className="space-y-2 text-[12px]">
                {findings.map((f) => (
                  <li key={f.id} className="rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                    <p className="font-semibold">{f.type}</p>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap" style={{ color: "var(--office-text-secondary)" }}>
                      {JSON.stringify(f.payload, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Deliverables */}
          <Section title="Deliverables">
            {deliverables.length === 0 ? (
              <EmptyState message="成果物はまだありません。" />
            ) : (
              <ul className="space-y-1 text-[12px]">
                {deliverables.map((d) => (
                  <li key={d.id} className="flex items-center justify-between">
                    <span>{d.title}</span>
                    <span style={{ color: d.status === "delivered" ? "var(--office-status-completed)" : "var(--office-text-secondary)" }}>{d.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </main>

        <aside className="space-y-4">
          {/* Delivery Gate */}
          <Section title="Delivery Gate">
            <ul className="space-y-2 text-[12px]">
              <GateRow label="Execution Complete" passed={deliveryGate.executionComplete} />
              <GateRow label="Critic Passed" passed={deliveryGate.criticPassed} />
              <GateRow label="QA Passed" passed={deliveryGate.qaPassed} />
              <GateRow label="CEO Approved" passed={deliveryGate.ceoApproved} />
            </ul>
          </Section>

          {/* Approvals */}
          <Section title={`Approvals (${pendingApprovals.length})`}>
            {approvals.length === 0 ? (
              <EmptyState message="承認はまだありません。" />
            ) : (
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id} className="rounded-md border p-2 text-[12px]" style={{ borderColor: "var(--office-border)" }}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{a.title}</span>
                      <span
                        style={{
                          color:
                            a.status === "approved"
                              ? "var(--office-status-completed)"
                              : a.status === "pending"
                                ? "var(--office-status-waiting-human)"
                                : "var(--office-status-failed)",
                        }}
                      >
                        {a.status}
                      </span>
                    </div>
                    {a.status === "pending" && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => decide(a.id, "approve")}
                          className="rounded px-2 py-1 text-[11px] font-semibold text-white"
                          style={{ background: "var(--office-status-completed)" }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setReasonFor(reasonFor === a.id ? null : a.id)}
                          className="rounded border px-2 py-1 text-[11px]"
                          style={{ borderColor: "var(--office-border)" }}
                        >
                          Reject/Revise
                        </button>
                      </div>
                    )}
                    {reasonFor === a.id && (
                      <div className="mt-1.5 space-y-1">
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="理由（必須）"
                          rows={2}
                          className="w-full rounded border p-1 text-[11px]"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                        <div className="flex gap-1.5">
                          <button disabled={!reason.trim()} onClick={() => decide(a.id, "revise", reason)} className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--office-status-waiting-human)" }}>
                            Revise
                          </button>
                          <button disabled={!reason.trim()} onClick={() => decide(a.id, "reject", reason)} className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--office-status-failed)" }}>
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="h-28">
            <Timeline runs={workflowRuns} events={events} />
          </div>
        </aside>
      </div>

      {drawerAgentId && <AgentDrawer agentId={drawerAgentId} role={role} onClose={() => setDrawerAgentId(null)} />}
    </div>
  );
}

function GateRow({ label, passed }: { label: string; passed: boolean }) {
  const Icon = passed ? CheckCircle2 : Circle;
  return (
    <li className="flex items-center gap-2">
      <Icon className="h-4 w-4" style={{ color: passed ? "var(--office-status-completed)" : "var(--office-text-muted)" }} aria-hidden />
      <span style={{ color: passed ? "var(--office-text-primary)" : "var(--office-text-muted)" }}>{label}</span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
      <h2 className="mb-2 text-sm font-bold">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-[12px]" style={{ color: "var(--office-text-muted)" }}>
      {message}
    </p>
  );
}
