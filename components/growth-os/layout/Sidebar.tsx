"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Search,
  Lightbulb,
  MessageCircle,
  FileText,
  Package,
  Calendar,
  BarChart3,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  GROWTH_OS_DASHBOARD_ROUTE,
  GROWTH_OS_RESEARCH_ROUTE,
  GROWTH_OS_IDEAS_ROUTE,
  GROWTH_OS_THREADS_ROUTE,
  GROWTH_OS_NOTE_ROUTE,
  GROWTH_OS_PRODUCTS_ROUTE,
  GROWTH_OS_CALENDAR_ROUTE,
  GROWTH_OS_ANALYTICS_ROUTE,
  GROWTH_OS_SETTINGS_ROUTE,
} from "@/lib/routes";

const NAV_ITEMS = [
  { href: GROWTH_OS_DASHBOARD_ROUTE, label: "Dashboard", icon: LayoutDashboard },
  { href: GROWTH_OS_RESEARCH_ROUTE, label: "Research", icon: Search },
  { href: GROWTH_OS_IDEAS_ROUTE, label: "Ideas", icon: Lightbulb },
  { href: GROWTH_OS_THREADS_ROUTE, label: "Threads", icon: MessageCircle },
  { href: GROWTH_OS_NOTE_ROUTE, label: "note", icon: FileText },
  { href: GROWTH_OS_PRODUCTS_ROUTE, label: "Products", icon: Package },
  { href: GROWTH_OS_CALENDAR_ROUTE, label: "Calendar", icon: Calendar },
  { href: GROWTH_OS_ANALYTICS_ROUTE, label: "Analytics", icon: BarChart3 },
  { href: GROWTH_OS_SETTINGS_ROUTE, label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-full flex-col gap-1 p-3" aria-label="note Growth OS ナビゲーション">
      <div className="px-3 py-4">
        <p className="text-sm font-semibold text-neutral-900">note Growth OS</p>
        <p className="text-xs text-gray-400">50代のセカンドキャリア事業運営</p>
      </div>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-neutral-900 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-neutral-900"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
