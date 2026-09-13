"use client";

export interface ActivityEvent {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
  fromAgentName: string | null;
  toAgentName: string | null;
}

const EVENT_ICON: Record<string, string> = {
  "agent.started": "▶",
  "agent.completed": "✓",
  "agent.failed": "✕",
  "agent.handoff": "→",
  "critic.rejected": "⚠",
  "qa.passed": "✓",
  "approval.requested": "?",
  "approval.approved": "✓",
  "approval.rejected": "✕",
  "lead.created": "＋",
  "opportunity.won": "★",
  "project.created": "＋",
  "team.created": "◇",
  "task.created": "◇",
  "delivery.completed": "★",
};

export default function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-slate-900/50">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-100">Activity Feed</h2>
        <p className="text-[11px] text-slate-500">いま起きていること（DBイベント連動）</p>
      </div>
      <ul className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {events.length === 0 && <li className="text-sm text-slate-500">まだイベントはありません。</li>}
        {events.map((event) => (
          <li key={event.id} className="text-[12px]">
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500">
                {new Date(event.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="text-slate-600">{EVENT_ICON[event.event_type] ?? "•"}</span>
            </div>
            <p className="mt-0.5 text-slate-200">
              {event.fromAgentName && (
                <span className="font-semibold text-sky-300">
                  {event.fromAgentName}
                  {event.toAgentName ? ` → ${event.toAgentName}` : ""}
                </span>
              )}
              {event.fromAgentName ? " " : ""}
              {event.message}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
