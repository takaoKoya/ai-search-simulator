"use client";

import { useEffect, useState } from "react";
import { statusLabel } from "@/lib/office/status";

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
    node_name: string;
    status: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    started_at: string;
    completed_at: string | null;
    error: string | null;
  }>;
  events: Array<{ id: string; event_type: string; message: string | null; created_at: string }>;
  toolCalls: Array<{ id: string; agent_run_id: string; tool_name: string; status: string }>;
}

function elapsed(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

export default function AgentDrawer({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/detail`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setDetail(data);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const loading = !detail || detail.agent.id !== agentId;
  const latestRun = detail?.runs[0];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-[520px] flex-col overflow-y-auto border-l border-white/10 bg-slate-950 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{detail?.agent.name ?? "読み込み中..."}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-white/10 hover:text-white">
            閉じる
          </button>
        </div>

        {loading && <p className="mt-6 text-sm text-slate-400">読み込み中...</p>}

        {!loading && detail && (
          <div className="mt-4 space-y-6 text-sm">
            <section className="grid grid-cols-2 gap-3 rounded-lg border border-white/10 bg-slate-900/60 p-3">
              <Field label="Role" value={detail.agent.job_title ?? detail.agent.role} />
              <Field label="Status" value={statusLabel(detail.agent.status)} />
              <Field label="Project" value={detail.project?.name ?? "—"} />
              <Field label="Current Task" value={detail.task?.title ?? "—"} />
              <Field label="Model" value={`${detail.agent.provider}${detail.agent.model ? " / " + detail.agent.model : ""}`} />
              <Field
                label="Started / Elapsed"
                value={latestRun ? `${new Date(latestRun.started_at).toLocaleTimeString("ja-JP")} / ${elapsed(latestRun.started_at, latestRun.completed_at)}` : "—"}
              />
            </section>

            {detail.agent.description && <p className="text-slate-300">{detail.agent.description}</p>}

            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Agent Runs</h3>
              <ul className="space-y-2">
                {detail.runs.length === 0 && <li className="text-slate-500">実行履歴はまだありません。</li>}
                {detail.runs.map((run) => (
                  <li key={run.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{run.node_name}</span>
                      <span
                        className={
                          run.status === "completed"
                            ? "text-emerald-400"
                            : run.status === "failed"
                              ? "text-rose-400"
                              : "text-sky-400"
                        }
                      >
                        {run.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {new Date(run.started_at).toLocaleString("ja-JP")} ・ {elapsed(run.started_at, run.completed_at)}
                    </p>
                    {run.error && <p className="mt-1 text-rose-400">Error: {run.error}</p>}
                    {"summary" in (run.output ?? {}) && (
                      <p className="mt-1 text-slate-300">{String((run.output as Record<string, unknown>).summary ?? "")}</p>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-slate-500">Input / Output</summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/40 p-2 text-[10px] text-slate-400">
                        {JSON.stringify({ input: run.input, output: run.output }, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Handoffs / Events</h3>
              <ul className="space-y-1">
                {detail.events.length === 0 && <li className="text-slate-500">イベントはまだありません。</li>}
                {detail.events.map((event) => (
                  <li key={event.id} className="text-[12px] text-slate-300">
                    <span className="text-slate-500">{new Date(event.created_at).toLocaleTimeString("ja-JP")}</span> {event.message}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="truncate text-slate-200">{value}</p>
    </div>
  );
}
