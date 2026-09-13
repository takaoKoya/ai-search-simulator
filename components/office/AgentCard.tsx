"use client";

import { getStatusMeta } from "@/lib/office/status";

export interface AgentCardData {
  id: string;
  name: string;
  role: string;
  job_title: string | null;
  status: string;
  avatar: string | null;
  notificationCount: number;
  currentProjectName: string | null;
  currentTaskTitle: string | null;
  progress: { done: number; total: number } | null;
}

// Deterministic (not random) avatar background per agent id, so the same
// agent always gets the same color across reloads/sessions.
const AVATAR_PALETTE = ["#0ea5e9", "#22c55e", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6", "#f43f5e", "#84cc16"];
function avatarColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export default function AgentCard({ agent, onClick }: { agent: AgentCardData; onClick: () => void }) {
  const meta = getStatusMeta(agent.status);
  const StatusIcon = meta.icon;
  const progressPct = agent.progress && agent.progress.total > 0 ? Math.round((agent.progress.done / agent.progress.total) * 100) : null;

  return (
    <button
      onClick={onClick}
      aria-label={`${agent.name}(${meta.label})の詳細を開く`}
      className="relative w-[194px] min-h-[158px] shrink-0 rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--office-ai-accent)]"
      style={{
        borderColor: "var(--office-border)",
        background: "var(--office-surface)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--office-surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--office-surface)")}
    >
      {agent.notificationCount > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
          style={{ background: "var(--office-status-failed)" }}
          aria-label={`${agent.notificationCount}件の要確認`}
        >
          {agent.notificationCount}
        </span>
      )}

      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: avatarColorFor(agent.id) }}
          aria-hidden
        >
          {agent.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" style={{ color: "var(--office-text-primary)" }}>
            {agent.name}
          </p>
          <p className="truncate text-[11px]" style={{ color: "var(--office-text-secondary)" }}>
            {agent.job_title ?? agent.role}
          </p>
        </div>
      </div>

      <div
        className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.animationClass ?? ""}`}
        style={{ color: `var(${meta.colorVar})`, background: `color-mix(in srgb, var(${meta.colorVar}) 16%, transparent)` }}
      >
        <StatusIcon className="h-3 w-3" aria-hidden />
        {meta.label}
      </div>

      <div className="mt-2 space-y-0.5 text-[11px]" style={{ color: "var(--office-text-secondary)" }}>
        <p className="truncate">案件: {agent.currentProjectName ?? "—"}</p>
        <p className="truncate">作業: {agent.currentTaskTitle ?? "—"}</p>
      </div>

      <div className="mt-2.5">
        {progressPct !== null ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--office-bg-secondary)" }}>
            <div className="h-full rounded-full" style={{ width: `${progressPct}%`, background: "var(--office-ai-accent)" }} />
          </div>
        ) : (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: "var(--office-bg-secondary)" }}
            role="img"
            aria-label="進捗算出不能"
          >
            <div className="h-full w-1/3 rounded-full opacity-60" style={{ background: "var(--office-text-muted)" }} />
          </div>
        )}
        <p className="mt-1 text-[10px]" style={{ color: "var(--office-text-muted)" }}>
          {agent.progress ? `Progress ${agent.progress.done}/${agent.progress.total}` : "Progress indeterminate"}
        </p>
      </div>
    </button>
  );
}
