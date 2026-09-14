"use client";

import { useEffect, useState } from "react";
import { getStatusMeta, statusLabel } from "@/lib/office/status";
import { getEventMeta } from "@/lib/office/eventTypes";
import type { TenantRole } from "@/lib/server/tenant";

interface AgentDetail {
  agent: {
    id: string;
    name: string;
    role: string;
    job_title: string | null;
    description: string | null;
    status: string;
    provider: string;
    model: string | null;
  };
  project: { id: string; name: string; status: string } | null;
  task: { id: string; title: string; status: string } | null;
  runs: Array<{
    id: string;
    workflow_run_id: string | null;
    node_name: string;
    status: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    started_at: string;
    completed_at: string | null;
    error: string | null;
  }>;
  events: Array<{
    id: string;
    event_type: string;
    message: string | null;
    from_agent_id: string | null;
    to_agent_id: string | null;
    created_at: string;
  }>;
  toolCalls: Array<{ id: string; agent_run_id: string; tool_name: string; status: string }>;
  findings: Array<{ id: string; type: string; payload: Record<string, unknown>; created_at: string }>;
}

type TabKey = "overview" | "activity" | "evidence" | "tools" | "technical";

function elapsed(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export default function AgentDrawer({ agentId, role, onClose }: { agentId: string; role: TenantRole; onClose: () => void }) {
  type LoadState = { agentId: string; detail: AgentDetail } | { agentId: string; error: string };
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const canSeeTechnical = role === "owner" || role === "ceo" || role === "admin";
  const [tab, setTab] = useState<TabKey>("overview");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/detail`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.agent) {
          setLoadState({ agentId, error: data?.error ?? "Agent情報の取得に失敗しました" });
          return;
        }
        setLoadState({ agentId, detail: data as AgentDetail });
      })
      .catch(() => {
        if (!cancelled) setLoadState({ agentId, error: "Agent情報の取得に失敗しました" });
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const currentLoadState = loadState?.agentId === agentId ? loadState : null;
  const detail = currentLoadState && "detail" in currentLoadState ? currentLoadState.detail : null;
  const fetchError = currentLoadState && "error" in currentLoadState ? currentLoadState.error : null;
  const loading = !currentLoadState;
  const latestRun = detail?.runs[0];
  const meta = detail ? getStatusMeta(detail.agent.status) : null;

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "activity", label: "Activity" },
    { key: "evidence", label: "Evidence" },
    { key: "tools", label: "Tools" },
    ...(canSeeTechnical ? ([{ key: "technical", label: "Technical" }] as const) : []),
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-10 flex h-full w-full max-w-[520px] flex-col overflow-y-auto border-l p-5 shadow-2xl"
        style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)", color: "var(--office-text-primary)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{detail?.agent.name ?? (fetchError ? "読み込みエラー" : "読み込み中...")}</h2>
            {meta && (
              <span className="text-[12px]" style={{ color: `var(${meta.colorVar})` }}>
                {statusLabel(detail!.agent.status)}
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm hover:bg-white/10" style={{ color: "var(--office-text-secondary)" }}>
            閉じる
          </button>
        </div>

        {loading && (
          <div className="mt-6 space-y-2" aria-label="読み込み中">
            <div className="h-4 w-2/3 animate-pulse rounded" style={{ background: "var(--office-surface)" }} />
            <div className="h-4 w-1/2 animate-pulse rounded" style={{ background: "var(--office-surface)" }} />
            <div className="h-24 w-full animate-pulse rounded" style={{ background: "var(--office-surface)" }} />
          </div>
        )}

        {fetchError && !detail && (
          <div
            className="mt-6 rounded-lg border p-3 text-[13px]"
            style={{ borderColor: "var(--office-status-failed)", background: "color-mix(in srgb, var(--office-status-failed) 10%, transparent)" }}
          >
            <p className="font-semibold" style={{ color: "var(--office-status-failed)" }}>
              Agent情報を取得できませんでした
            </p>
            <p className="mt-1" style={{ color: "var(--office-text-secondary)" }}>
              {fetchError}
            </p>
          </div>
        )}

        {!loading && detail && (
          <>
            <div className="mt-4 flex gap-1 border-b" style={{ borderColor: "var(--office-border)" }}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="px-3 py-2 text-[12px] font-semibold"
                  style={{
                    color: tab === t.key ? "var(--office-ai-accent)" : "var(--office-text-muted)",
                    borderBottom: tab === t.key ? "2px solid var(--office-ai-accent)" : "2px solid transparent",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-4 text-sm">
              {tab === "overview" && <OverviewTab detail={detail} latestRun={latestRun} />}
              {tab === "activity" && <ActivityTab detail={detail} />}
              {tab === "evidence" && <EvidenceTab detail={detail} />}
              {tab === "tools" && <ToolsTab detail={detail} />}
              {tab === "technical" && canSeeTechnical && <TechnicalTab detail={detail} latestRun={latestRun} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
        {label}
      </p>
      <p className="truncate" style={{ color: "var(--office-text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
      {children}
    </div>
  );
}

function OverviewTab({ detail, latestRun }: { detail: AgentDetail; latestRun?: AgentDetail["runs"][number] }) {
  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" value={detail.agent.job_title ?? detail.agent.role} />
          <Field label="Project" value={detail.project?.name ?? "—"} />
          <Field label="Current Task" value={detail.task?.title ?? "—"} />
          <Field
            label="Started / Elapsed"
            value={latestRun ? `${new Date(latestRun.started_at).toLocaleTimeString("ja-JP")} / ${elapsed(latestRun.started_at, latestRun.completed_at)}` : "—"}
          />
        </div>
      </Panel>
      {detail.agent.description && (
        <p className="text-[13px]" style={{ color: "var(--office-text-secondary)" }}>
          {detail.agent.description}
        </p>
      )}
      {!latestRun && (
        <p className="text-[13px]" style={{ color: "var(--office-text-muted)" }}>
          実行履歴はまだありません。
        </p>
      )}
      {latestRun?.status === "failed" && (
        <div className="rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--office-status-failed)", background: "color-mix(in srgb, var(--office-status-failed) 10%, transparent)" }}>
          <p className="font-semibold" style={{ color: "var(--office-status-failed)" }}>
            {latestRun.node_name}でデータ取得に失敗
          </p>
          <p className="mt-1" style={{ color: "var(--office-text-secondary)" }}>
            原因: {latestRun.error ?? "不明なエラー"}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--office-text-muted)" }}>
            自動リトライは Phase 2 時点で未実装です。Leadsパネルから再実行してください。
          </p>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ detail }: { detail: AgentDetail }) {
  const timeline = detail.events.slice().reverse();
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
        時系列
      </h3>
      {timeline.length === 0 && (
        <p className="text-[13px]" style={{ color: "var(--office-text-muted)" }}>
          イベントはまだありません。
        </p>
      )}
      <ol className="space-y-2 border-l pl-3" style={{ borderColor: "var(--office-border)" }}>
        {timeline.map((event) => {
          const meta = getEventMeta(event);
          return (
            <li key={event.id} className="text-[12px]">
              <span style={{ color: "var(--office-text-muted)" }}>{new Date(event.created_at).toLocaleTimeString("ja-JP")}</span>{" "}
              <span style={{ color: "var(--office-text-primary)" }}>{event.message ?? meta.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EvidenceTab({ detail }: { detail: AgentDetail }) {
  if (detail.findings.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-[13px]" style={{ borderColor: "var(--office-border)", color: "var(--office-text-muted)" }}>
        この結論にはまだEvidenceが紐づいていません。（Evidenceの無い結論は視覚的に区別されます）
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {detail.findings.map((f) => (
        <li key={f.id} className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
          <p className="font-semibold" style={{ color: "var(--office-text-primary)" }}>
            {f.type}
          </p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap" style={{ color: "var(--office-text-secondary)" }}>
            {JSON.stringify(f.payload, null, 2)}
          </pre>
          <p className="mt-1 text-[10px]" style={{ color: "var(--office-text-muted)" }}>
            {new Date(f.created_at).toLocaleString("ja-JP")}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ToolsTab({ detail }: { detail: AgentDetail }) {
  if (detail.toolCalls.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: "var(--office-text-muted)" }}>
        Tool呼び出しの記録はありません。
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {detail.toolCalls.map((tc) => (
        <li key={tc.id} className="rounded-lg border p-2 text-[12px]" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
          <span className="font-semibold" style={{ color: "var(--office-text-primary)" }}>
            {tc.tool_name}
          </span>{" "}
          <span style={{ color: "var(--office-text-muted)" }}>{tc.status}</span>
        </li>
      ))}
    </ul>
  );
}

function TechnicalTab({ detail, latestRun }: { detail: AgentDetail; latestRun?: AgentDetail["runs"][number] }) {
  const handoffs = detail.events.filter((e) => e.event_type === "agent.handoff");
  const errors = detail.events.filter((e) => getEventMeta(e).severity === "error");
  const warnings = detail.events.filter((e) => getEventMeta(e).severity === "warning");

  return (
    <div className="space-y-5">
      <Panel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Model / Provider" value={`${detail.agent.provider}${detail.agent.model ? " / " + detail.agent.model : ""}`} />
          <Field label="Retry History" value="なし（Phase 2時点で自動リトライは未実装）" />
        </div>
      </Panel>

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
          Agent Runs
        </h3>
        <ul className="space-y-2">
          {detail.runs.length === 0 && (
            <li className="text-[13px]" style={{ color: "var(--office-text-muted)" }}>
              実行履歴はまだありません。
            </li>
          )}
          {detail.runs.map((run) => (
            <li key={run.id} className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: "var(--office-text-primary)" }}>
                  {run.node_name}
                </span>
                <span
                  style={{
                    color:
                      run.status === "completed" ? "var(--office-status-completed)" : run.status === "failed" ? "var(--office-status-failed)" : "var(--office-status-thinking)",
                  }}
                >
                  {run.status}
                </span>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                {new Date(run.started_at).toLocaleString("ja-JP")} ・ {elapsed(run.started_at, run.completed_at)}
              </p>
              {run.error && (
                <p className="mt-1" style={{ color: "var(--office-status-failed)" }}>
                  Error: {run.error}
                </p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                  Input / Output
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded p-2 text-[10px]" style={{ background: "var(--office-bg-primary)", color: "var(--office-text-muted)" }}>
                  {JSON.stringify({ input: run.input, output: run.output }, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
          Handoff History
        </h3>
        {handoffs.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--office-text-muted)" }}>
            なし
          </p>
        ) : (
          <ul className="space-y-1">
            {handoffs.map((h) => (
              <li key={h.id} className="text-[12px]" style={{ color: "var(--office-text-secondary)" }}>
                {new Date(h.created_at).toLocaleTimeString("ja-JP")} {h.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(warnings.length > 0 || errors.length > 0) && (
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
            Warnings / Errors
          </h3>
          <ul className="space-y-1">
            {[...warnings, ...errors].map((e) => (
              <li key={e.id} className="text-[12px]" style={{ color: getEventMeta(e).severity === "error" ? "var(--office-status-failed)" : "var(--office-status-warning)" }}>
                {new Date(e.created_at).toLocaleTimeString("ja-JP")} {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {latestRun && (
        <Panel>
          <Field label="Checkpoint (workflow_run)" value={latestRun.workflow_run_id ? String(latestRun.workflow_run_id) : "—"} />
        </Panel>
      )}
    </div>
  );
}
