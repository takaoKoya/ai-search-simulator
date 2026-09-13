import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BellRing,
  Brain,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock,
  Globe,
  Laptop,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type AgentStatus =
  | "idle"
  | "queued"
  | "thinking"
  | "working"
  | "tool_calling"
  | "waiting_external"
  | "waiting_human"
  | "reviewing"
  | "handoff"
  | "completed"
  | "warning"
  | "failed";

interface StatusMeta {
  label: string;
  icon: LucideIcon;
  colorVar: string; // CSS custom property name, see globals.css `.ai-office`
  animationClass: string | null;
}

export const STATUS_META: Record<string, StatusMeta> = {
  idle: { label: "待機中", icon: Circle, colorVar: "--office-status-idle", animationClass: null },
  queued: { label: "順番待ち", icon: Clock, colorVar: "--office-status-queued", animationClass: null },
  thinking: { label: "思考中", icon: Brain, colorVar: "--office-status-thinking", animationClass: "status-anim-thinking" },
  working: { label: "作業中", icon: Laptop, colorVar: "--office-status-working", animationClass: "status-anim-working" },
  tool_calling: {
    label: "ツール実行中",
    icon: Search,
    colorVar: "--office-status-tool-calling",
    animationClass: "status-anim-tool_calling",
  },
  waiting_external: {
    label: "外部待ち",
    icon: Globe,
    colorVar: "--office-status-waiting-external",
    animationClass: "status-anim-waiting_external",
  },
  waiting_human: {
    label: "CEO確認待ち",
    icon: BellRing,
    colorVar: "--office-status-waiting-human",
    animationClass: "status-anim-waiting_human",
  },
  reviewing: {
    label: "レビュー中",
    icon: ClipboardCheck,
    colorVar: "--office-status-reviewing",
    animationClass: "status-anim-reviewing",
  },
  handoff: { label: "引き継ぎ中", icon: ArrowLeftRight, colorVar: "--office-status-handoff", animationClass: null },
  completed: {
    label: "完了",
    icon: CheckCircle2,
    colorVar: "--office-status-completed",
    animationClass: "status-anim-completed",
  },
  warning: { label: "要確認", icon: AlertTriangle, colorVar: "--office-status-warning", animationClass: null },
  failed: { label: "失敗", icon: XCircle, colorVar: "--office-status-failed", animationClass: "status-anim-failed" },
};

const FALLBACK_META: StatusMeta = { label: "不明", icon: Circle, colorVar: "--office-status-idle", animationClass: null };

export function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? FALLBACK_META;
}

export function statusLabel(status: string): string {
  return getStatusMeta(status).label;
}

/** Notification bell icon re-exported for card badges (kept distinct from BellRing used for waiting_human). */
export const NotificationIcon = Bell;
