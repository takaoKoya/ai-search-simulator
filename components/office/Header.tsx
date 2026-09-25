"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Search, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LOGIN_ROUTE } from "@/lib/routes";
import type { OfficeState } from "@/lib/server/officeState";
import type { TenantRole } from "@/lib/server/tenant";
import IntegrationsPanel from "@/components/office/IntegrationsPanel";

export interface QuickSearchHit {
  kind: "lead" | "project" | "agent" | "approval";
  id: string;
  label: string;
  sublabel: string;
}

export interface NotificationItem {
  id: string;
  message: string;
  tone: "warning" | "error" | "info";
}

export default function Header({
  tenantName,
  role,
  state,
  notifications,
  onOpenLead,
  onOpenAgent,
  onOpenApproval,
  onOpenProject,
}: {
  tenantName: string;
  role: TenantRole;
  state: OfficeState;
  notifications: NotificationItem[];
  onOpenLead: () => void;
  onOpenAgent: (id: string) => void;
  onOpenApproval: () => void;
  onOpenProject: (id: string) => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);

  useEffect(() => {
    const initial = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);

  const hits = useMemo<QuickSearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: QuickSearchHit[] = [];
    for (const lead of state.leads) {
      if (lead.company_name.toLowerCase().includes(q)) {
        results.push({ kind: "lead", id: lead.id, label: lead.company_name, sublabel: `Lead ・ ${lead.status}` });
      }
    }
    for (const project of state.projects) {
      if (project.name.toLowerCase().includes(q)) {
        results.push({ kind: "project", id: project.id, label: project.name, sublabel: `Project ・ ${project.status}` });
      }
    }
    for (const agent of state.agents) {
      if (agent.name.toLowerCase().includes(q) || (agent.job_title ?? "").toLowerCase().includes(q)) {
        results.push({ kind: "agent", id: agent.id, label: agent.name, sublabel: agent.job_title ?? agent.role });
      }
    }
    for (const approval of state.pendingApprovals) {
      if (approval.title.toLowerCase().includes(q)) {
        results.push({ kind: "approval", id: approval.id, label: approval.title, sublabel: "承認待ち" });
      }
    }
    return results.slice(0, 8);
  }, [query, state]);

  function handleSelect(hit: QuickSearchHit) {
    setQuery("");
    setSearchOpen(false);
    if (hit.kind === "lead") onOpenLead();
    else if (hit.kind === "project") onOpenProject(hit.id);
    else if (hit.kind === "agent") onOpenAgent(hit.id);
    else onOpenApproval();
  }

  async function handleSignOut() {
    await createClient().auth.signOut();
    window.location.href = LOGIN_ROUTE;
  }

  return (
    <header
      className="relative z-20 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur"
      style={{ borderColor: "var(--office-border)", background: "color-mix(in srgb, var(--office-bg-secondary) 85%, transparent)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-lg font-bold tracking-tight" style={{ color: "var(--office-text-primary)" }}>
          AI Office
        </span>
        <span className="hidden truncate text-xs sm:inline" style={{ color: "var(--office-text-muted)" }}>
          {tenantName}
        </span>
      </div>

      <div className="relative hidden max-w-sm flex-1 md:block">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
          style={{ color: "var(--office-text-muted)" }}
          aria-hidden
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          placeholder="Lead / Project / Agent / Approvalを検索"
          aria-label="全体検索"
          className="w-full rounded-lg border py-1.5 pl-8 pr-3 text-xs outline-none"
          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)", color: "var(--office-text-primary)" }}
        />
        {searchOpen && query.trim() && (
          <ul
            className="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded-lg border shadow-xl"
            style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)" }}
          >
            {hits.length === 0 && (
              <li className="px-3 py-2 text-xs" style={{ color: "var(--office-text-muted)" }}>
                一致する結果がありません（表示中のデータのみ検索対象）
              </li>
            )}
            {hits.map((hit) => (
              <li key={`${hit.kind}-${hit.id}`}>
                <button
                  onMouseDown={() => handleSelect(hit)}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-white/5"
                  style={{ color: "var(--office-text-primary)" }}
                >
                  <span className="font-semibold">{hit.label}</span>
                  <span className="ml-2" style={{ color: "var(--office-text-muted)" }}>
                    {hit.sublabel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="relative">
          <button
            onClick={() => setNotifOpen((v) => !v)}
            aria-label={`通知 ${notifications.length}件`}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/5"
          >
            <Bell className="h-4 w-4" style={{ color: "var(--office-text-secondary)" }} aria-hidden />
            {notifications.length > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: "var(--office-status-failed)" }}
              >
                {notifications.length}
              </span>
            )}
          </button>
          {notifOpen && (
            <ul
              className="absolute right-0 top-full mt-1 w-72 max-h-72 overflow-y-auto rounded-lg border p-1 shadow-xl"
              style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)" }}
            >
              {notifications.length === 0 && (
                <li className="px-2 py-2 text-xs" style={{ color: "var(--office-text-muted)" }}>
                  通知はありません
                </li>
              )}
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className="rounded-md px-2 py-1.5 text-xs"
                  style={{
                    color: n.tone === "error" ? "var(--office-status-failed)" : n.tone === "warning" ? "var(--office-status-warning)" : "var(--office-text-secondary)",
                  }}
                >
                  {n.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <span className="hidden text-[11px] tabular-nums sm:inline" style={{ color: "var(--office-text-muted)" }}>
          {now ? now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
        </span>

        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label="ユーザーメニュー"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/5"
          >
            <User className="h-4 w-4" style={{ color: "var(--office-text-secondary)" }} aria-hidden />
          </button>
          {userMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-44 rounded-lg border p-2 shadow-xl"
              style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)" }}
            >
              <p className="px-2 py-1 text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                Role: {role}
              </p>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  setIntegrationsOpen(true);
                }}
                className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5"
                style={{ color: "var(--office-text-primary)" }}
              >
                連携設定（Google）
              </button>
              <button
                onClick={handleSignOut}
                className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5"
                style={{ color: "var(--office-text-primary)" }}
              >
                ログアウト
              </button>
            </div>
          )}
        </div>
      </div>

      {integrationsOpen && <IntegrationsPanel onClose={() => setIntegrationsOpen(false)} />}
    </header>
  );
}
