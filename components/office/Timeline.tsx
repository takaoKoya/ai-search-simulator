"use client";

import { eventLabel } from "@/lib/office/eventTypes";

export interface TimelineRun {
  id: string;
  graph_name: string;
  status: string;
  current_node: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
  workflow_run_id?: string | null;
  from_agent_id?: string | null;
  to_agent_id?: string | null;
}

const HOUR_MARKS = [6, 9, 12, 15, 18, 22];
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;

function minutesSinceDayStart(date: Date): number {
  return (date.getHours() - DAY_START_HOUR) * 60 + date.getMinutes();
}

const DAY_SPAN_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

/**
 * Today's workflow timeline, plotted on an hour axis (not just a flat list)
 * per the design brief — click a marker to open that event's detail.
 */
export default function Timeline({
  runs,
  events,
  onOpenEvent,
}: {
  runs: TimelineRun[];
  events: TimelineEvent[];
  onOpenEvent?: (event: TimelineEvent) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaysEvents = events
    .filter((e) => new Date(e.created_at) >= today)
    .filter((e) => !e.event_type.startsWith("agent.started") && !e.event_type.startsWith("agent.completed")) // keep the axis readable; agent_runs detail lives in the Drawer
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <div
      className="flex h-full flex-col justify-center gap-1.5 overflow-hidden rounded-xl border px-4 py-2"
      style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
          Timeline ・ Today
        </span>
        {runs.length === 0 && (
          <span className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
            ワークフローの実行はまだありません。
          </span>
        )}
      </div>

      <div className="relative h-8 w-full">
        {/* hour axis */}
        <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: "var(--office-border)" }} />
        {HOUR_MARKS.map((h) => {
          const pct = ((h - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100;
          return (
            <span
              key={h}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px]"
              style={{ left: `${pct}%`, color: "var(--office-text-muted)" }}
            >
              {String(h).padStart(2, "0")}:00
            </span>
          );
        })}
        {/* event markers, offset below the hour labels */}
        {todaysEvents.map((event) => {
          const minutes = minutesSinceDayStart(new Date(event.created_at));
          const clamped = Math.min(Math.max(minutes, 0), DAY_SPAN_MINUTES);
          const pct = (clamped / DAY_SPAN_MINUTES) * 100;
          const label = eventLabel(event.event_type);
          return (
            <button
              key={event.id}
              onClick={() => onOpenEvent?.(event)}
              title={`${new Date(event.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} ${label}`}
              aria-label={`${label}: ${event.message ?? ""}`}
              className="absolute top-[calc(50%+6px)] h-2 w-2 -translate-x-1/2 rounded-full focus:outline-none focus-visible:ring-2"
              style={{ left: `${pct}%`, background: "var(--office-ai-accent)" }}
            />
          );
        })}
      </div>
    </div>
  );
}
