"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Users, Briefcase, Bell, AlertTriangle } from "lucide-react";
import AgentCard, { type AgentCardData } from "@/components/office/AgentCard";
import type { OfficeState } from "@/lib/server/officeState";

type DepartmentData = OfficeState["departments"][number];

/**
 * A department rendered as a "room": a header carrying the numbers a manager
 * actually wants (staffed/active, projects in flight, pending approvals,
 * warnings) above its own row of agent cards. Collapsible so a growing org
 * chart (spec explicitly expects more departments later) doesn't turn into
 * an endless scroll of cards with no orientation.
 */
export default function DepartmentRoom({
  department,
  toCardData,
  onSelectAgent,
  defaultExpanded = true,
}: {
  department: DepartmentData;
  toCardData: (agent: DepartmentData["agents"][number]) => AgentCardData;
  onSelectAgent: (id: string) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { stats } = department;

  return (
    <section
      className="rounded-2xl border"
      style={{ borderColor: "var(--office-border)", background: "linear-gradient(180deg, var(--office-surface) 0%, transparent 100%)" }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--office-text-muted)" }} aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--office-text-muted)" }} aria-hidden />
          )}
          <h2 className="text-sm font-bold" style={{ color: "var(--office-text-primary)" }}>
            {department.name}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--office-text-secondary)" }}>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden />
            <span style={{ color: stats.activeCount > 0 ? "var(--office-status-working)" : undefined }}>{stats.activeCount}</span>
            {" / "}
            {stats.totalCount} 稼働中
          </span>
          {stats.activeProjectCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Briefcase className="h-3.5 w-3.5" aria-hidden />
              案件 {stats.activeProjectCount}
            </span>
          )}
          {stats.pendingApprovalCount > 0 && (
            <span className="inline-flex items-center gap-1" style={{ color: "var(--office-status-waiting-human)" }}>
              <Bell className="h-3.5 w-3.5" aria-hidden />
              承認待ち {stats.pendingApprovalCount}
            </span>
          )}
          {stats.warningCount > 0 && (
            <span className="inline-flex items-center gap-1" style={{ color: "var(--office-status-warning)" }}>
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {stats.warningCount}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="flex flex-wrap gap-3 px-4 pb-4">
          {department.agents.length === 0 && (
            <p className="text-xs" style={{ color: "var(--office-text-muted)" }}>
              この部署にはまだAI社員がいません。
            </p>
          )}
          {department.agents.map((agent) => (
            <AgentCard key={agent.id as string} agent={toCardData(agent)} onClick={() => onSelectAgent(agent.id as string)} />
          ))}
        </div>
      )}
    </section>
  );
}
