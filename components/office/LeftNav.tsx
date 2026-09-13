"use client";

import {
  LayoutGrid,
  Users,
  Building2,
  Briefcase,
  ListChecks,
  Inbox,
  FileBarChart,
  Network,
  Settings,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  comingSoon?: boolean;
}

export default function LeftNav({
  activeKey,
  pendingApprovalCount,
  onNavigate,
}: {
  activeKey: string;
  pendingApprovalCount: number;
  onNavigate: (key: string) => void;
}) {
  const items: NavItem[] = [
    { key: "office", label: "Office", icon: LayoutGrid },
    { key: "leads", label: "Leads", icon: Users },
    { key: "clients", label: "Clients", icon: Building2, comingSoon: true },
    { key: "projects", label: "Projects", icon: Briefcase },
    { key: "tasks", label: "Tasks", icon: ListChecks, comingSoon: true },
    { key: "approvals", label: "Approvals", icon: Inbox, badge: pendingApprovalCount },
    { key: "reports", label: "Reports", icon: FileBarChart, comingSoon: true },
    { key: "organization", label: "Organization", icon: Network, comingSoon: true },
    { key: "settings", label: "Settings", icon: Settings, comingSoon: true },
  ];

  return (
    <nav
      className="flex flex-col items-center gap-1.5 rounded-xl border py-4"
      style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
      aria-label="メインナビゲーション"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeKey === item.key;
        return (
          <div key={item.key} className="group relative">
            <button
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.comingSoon ? `${item.label}（近日公開）` : item.label}
              className="relative flex h-11 w-11 items-center justify-center rounded-lg focus:outline-none focus-visible:ring-2"
              style={{
                background: isActive ? "color-mix(in srgb, var(--office-ai-accent) 20%, transparent)" : "transparent",
                color: isActive ? "var(--office-ai-accent)" : item.comingSoon ? "var(--office-text-muted)" : "var(--office-text-secondary)",
                opacity: item.comingSoon ? 0.55 : 1,
              }}
            >
              <Icon className="h-4.5 w-4.5" aria-hidden />
              {!!item.badge && item.badge > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                  style={{ background: "var(--office-status-failed)" }}
                >
                  {item.badge}
                </span>
              )}
            </button>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              style={{ background: "var(--office-bg-secondary)", color: "var(--office-text-primary)", border: "1px solid var(--office-border)" }}
            >
              {item.label}
              {item.comingSoon && <span style={{ color: "var(--office-text-muted)" }}> ・ Coming Soon</span>}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
