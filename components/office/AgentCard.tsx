"use client";

import { STATUS_DOT_CLASS, STATUS_TEXT_CLASS, statusLabel } from "@/lib/office/status";

export interface AgentCardData {
  id: string;
  name: string;
  role: string;
  job_title: string | null;
  status: string;
  currentProjectName: string | null;
  currentTaskTitle: string | null;
  progress: { done: number; total: number } | null;
}

export default function AgentCard({ agent, onClick }: { agent: AgentCardData; onClick: () => void }) {
  const progressPct = agent.progress && agent.progress.total > 0 ? Math.round((agent.progress.done / agent.progress.total) * 100) : null;

  return (
    <button
      onClick={onClick}
      className="w-[190px] min-h-[150px] shrink-0 rounded-xl border border-white/10 bg-slate-900/70 p-3 text-left transition-colors hover:border-sky-500/50 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-100">{agent.name}</p>
          <p className="truncate text-[11px] text-slate-400">{agent.job_title ?? agent.role}</p>
        </div>
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[agent.status] ?? "bg-slate-500"}`} aria-hidden />
      </div>

      <p className={`mt-2 text-[11px] font-semibold ${STATUS_TEXT_CLASS[agent.status] ?? "text-slate-400"}`}>{statusLabel(agent.status)}</p>

      <div className="mt-2 space-y-1 text-[11px] text-slate-400">
        <p className="truncate">案件: {agent.currentProjectName ?? "—"}</p>
        <p className="truncate">作業: {agent.currentTaskTitle ?? "—"}</p>
      </div>

      <div className="mt-3">
        {progressPct !== null ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${progressPct}%` }} />
          </div>
        ) : (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-slate-600" />
          </div>
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          {agent.progress ? `Progress ${agent.progress.done}/${agent.progress.total}` : "Progress —"}
        </p>
      </div>
    </button>
  );
}
