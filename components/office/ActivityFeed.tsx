"use client";

import { useMemo, useState } from "react";
import { FILTER_TABS, getEventMeta, type FilterKey, matchesFilter } from "@/lib/office/eventTypes";

export interface ActivityEvent {
  id: string;
  event_type: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  fromAgentName: string | null;
  toAgentName: string | null;
  from_agent_id?: string | null;
  to_agent_id?: string | null;
}

const SEVERITY_COLOR_VAR: Record<string, string> = {
  info: "--office-text-secondary",
  warning: "--office-status-warning",
  error: "--office-status-failed",
};

/**
 * Every row here is a DB `agent_events` row — nothing here is generated on a
 * timer or randomized. Clicking a row jumps to the most relevant detail:
 * the agent it involves, or the CEO Inbox for approval-lifecycle events.
 */
export default function ActivityFeed({
  events,
  onOpenAgent,
  onOpenApproval,
}: {
  events: ActivityEvent[];
  onOpenAgent?: (agentId: string) => void;
  onOpenApproval?: () => void;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(() => events.filter((e) => matchesFilter(e, filter)), [events, filter]);

  function handleClick(event: ActivityEvent) {
    if (event.event_type.startsWith("approval.") || event.event_type === "workflow.waiting_human") {
      onOpenApproval?.();
      return;
    }
    const agentId = event.to_agent_id ?? event.from_agent_id;
    if (agentId) onOpenAgent?.(agentId);
  }

  const clickable = Boolean(onOpenAgent || onOpenApproval);

  return (
    <div
      className="flex h-full flex-col rounded-xl border"
      style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
    >
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--office-border)" }}>
        <h2 className="text-sm font-bold" style={{ color: "var(--office-text-primary)" }}>
          Activity Feed
        </h2>
        <p className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
          いま起きていること（DBイベント連動）
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: filter === tab.key ? "color-mix(in srgb, var(--office-ai-accent) 25%, transparent)" : "transparent",
                color: filter === tab.key ? "var(--office-ai-accent)" : "var(--office-text-muted)",
                border: `1px solid ${filter === tab.key ? "var(--office-ai-accent)" : "var(--office-border)"}`,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {filtered.length === 0 && (
          <li className="text-sm" style={{ color: "var(--office-text-muted)" }}>
            {events.length === 0 ? "まだイベントはありません。" : "このフィルタに一致するイベントはありません。"}
          </li>
        )}
        {filtered.map((event) => {
          const meta = getEventMeta(event);
          const Row = (
            <div className="text-[12px]">
              <div className="flex items-baseline gap-2">
                <span style={{ color: "var(--office-text-muted)" }}>
                  {new Date(event.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span aria-hidden style={{ color: `var(${SEVERITY_COLOR_VAR[meta.severity]})` }}>
                  {meta.icon}
                </span>
              </div>
              <p className="mt-0.5" style={{ color: "var(--office-text-primary)" }}>
                {event.fromAgentName && (
                  <span className="font-semibold" style={{ color: "var(--office-ai-accent)" }}>
                    {event.fromAgentName}
                    {event.toAgentName ? ` → ${event.toAgentName}` : ""}
                  </span>
                )}
                {event.fromAgentName ? " " : ""}
                {event.message}
              </p>
            </div>
          );
          return (
            <li key={event.id}>
              {clickable ? (
                <button onClick={() => handleClick(event)} className="w-full rounded-md text-left hover:bg-white/5" aria-label={event.message ?? meta.label}>
                  {Row}
                </button>
              ) : (
                Row
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
