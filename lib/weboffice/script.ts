/**
 * WEB事業運用オフィス — a self-contained, fully client-side simulated demo
 * of an AI team running a store's SNS operations (research → writing →
 * production → publishing → DM handling → analytics), matching the visual
 * reference the user provided. Deliberately simulation-only for this first
 * version (no DB writes, no external APIs, no image/video generation) —
 * see README "WEB事業運用オフィス" section for what a real-backed version
 * would need (image/video generation API keys, Meta Graph API credentials
 * for real Instagram/Threads posting).
 */

export type RoleCode = "research" | "writing" | "production" | "ops" | "sales" | "analytics";

export interface Role {
  code: RoleCode;
  label: string;
  agentName: string;
  emoji: string;
  color: string;
  /** Grid position as a percentage of the office floor container. */
  x: number;
  y: number;
}

export const PRESIDENT_POSITION = { x: 50, y: 92 };

export const ROLES: Role[] = [
  { code: "research", label: "リサーチ", agentName: "リサ", emoji: "🔍", color: "#7fae7a", x: 16, y: 24 },
  { code: "writing", label: "執筆", agentName: "カク", emoji: "✍️", color: "#c9a25a", x: 50, y: 24 },
  { code: "ops", label: "運用", agentName: "ラン", emoji: "📮", color: "#d98a5f", x: 84, y: 24 },
  { code: "production", label: "制作", agentName: "サク", emoji: "🎨", color: "#e0c04a", x: 16, y: 60 },
  { code: "sales", label: "営業", agentName: "セイ", emoji: "💬", color: "#6c9fc9", x: 50, y: 60 },
  { code: "analytics", label: "分析", agentName: "アナ", emoji: "📊", color: "#a988c9", x: 84, y: 60 },
];

export function roleByCode(code: RoleCode): Role {
  const role = ROLES.find((r) => r.code === code);
  if (!role) throw new Error(`Unknown role: ${code}`);
  return role;
}

export interface DeskCard {
  title: string;
  value: string;
}

export interface ApprovalItem {
  agentName: string;
  title: string;
  body: string;
}

export interface TimelineEvent {
  id: string;
  /** Minutes elapsed since 06:00. */
  minute: number;
  log: string;
  /** Desk task card updates keyed by role, applied and persisted until the next update for that role. */
  deskUpdates?: Partial<Record<RoleCode, DeskCard>>;
  /** The agent currently "actively working", shown with a progress meter in the side panel. */
  active?: { role: RoleCode; task: string; progress: number };
  /** Triggers a flying hand-off animation between two desks ("president" for the CEO seat). */
  handoff?: { from: RoleCode | "president"; to: RoleCode | "president" };
  /** Surfaces something in the President's approval seat. */
  approval?: ApprovalItem;
}

export const DAY_START_MINUTE = 0; // 06:00
export const DAY_END_MINUTE = 16 * 60; // 22:00

function time(minute: number): string {
  const total = 6 * 60 + minute;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatClock(minute: number): string {
  return time(minute);
}

export const TIMELINE_EVENTS: TimelineEvent[] = [
  {
    id: "ev1",
    minute: 0,
    log: "リサが話題を集め始めた",
    deskUpdates: { research: { title: "話題", value: "収集中" } },
    active: { role: "research", task: "SNSトレンドと競合投稿を収集", progress: 15 },
  },
  {
    id: "ev2",
    minute: 4,
    log: "昨夜の投稿24件を確認",
    deskUpdates: { research: { title: "話題", value: "24件" } },
    active: { role: "research", task: "今日のネタを3行に要約", progress: 60 },
  },
  {
    id: "ev3",
    minute: 40,
    log: "リサが今日のネタを3行に要約",
    deskUpdates: { research: { title: "話題", value: "3行要約" } },
    handoff: { from: "research", to: "writing" },
    active: { role: "writing", task: "投稿文の下書きを作成", progress: 10 },
  },
  {
    id: "ev4",
    minute: 90,
    log: "カクが投稿文を執筆中",
    deskUpdates: { writing: { title: "投稿文", value: "執筆中" } },
    active: { role: "writing", task: "投稿文5本のドラフト作成", progress: 55 },
  },
  {
    id: "ev5",
    minute: 150,
    log: "カクが投稿案5本を仕上げた",
    deskUpdates: { writing: { title: "投稿文", value: "台本5本" } },
    handoff: { from: "writing", to: "president" },
    approval: {
      agentName: "カク",
      title: "投稿案5本の確認",
      body: "本日分のInstagram/Threads投稿案を5本作成しました。トーン・内容をご確認の上、承認をお願いします（このデモでは実際には投稿されません）。",
    },
  },
  {
    id: "ev6",
    minute: 165,
    log: "社長が投稿案を承認",
    handoff: { from: "president", to: "production" },
    active: { role: "production", task: "投稿用の画像・サムネを制作", progress: 20 },
  },
  {
    id: "ev7",
    minute: 189,
    log: "リールのサムネも仕上げた",
    deskUpdates: { production: { title: "画像", value: "サムネ完成" } },
    active: { role: "production", task: "投稿画像3枚を仕上げ中", progress: 80 },
  },
  {
    id: "ev8",
    minute: 192,
    log: "画像を持ってランの席へ",
    deskUpdates: { production: { title: "画像", value: "3枚完成" } },
    handoff: { from: "production", to: "ops" },
  },
  {
    id: "ev9",
    minute: 194,
    log: "ランが画像を受け取った",
    deskUpdates: { ops: { title: "予約投稿", value: "受信" } },
    active: { role: "ops", task: "投稿スケジュールを設定", progress: 30 },
  },
  {
    id: "ev10",
    minute: 360,
    log: "ランが予約どおりに投稿",
    deskUpdates: { ops: { title: "予約投稿", value: "投稿済み" } },
  },
  {
    id: "ev11",
    minute: 364,
    log: "Instagramに投稿済み（シミュレーション）",
  },
  {
    id: "ev12",
    minute: 368,
    log: "Threadsにも投稿済み（シミュレーション）",
  },
  {
    id: "ev13",
    minute: 372,
    log: "返信案と反応をセイの席へ",
    handoff: { from: "ops", to: "sales" },
    deskUpdates: { sales: { title: "DM", value: "反応ログ受信" } },
  },
  {
    id: "ev14",
    minute: 374,
    log: "セイが反応ログを受け取った",
    active: { role: "sales", task: "反応ログを確認", progress: 15 },
  },
  {
    id: "ev15",
    minute: 540,
    log: "セイが届いたDM12件を確認",
    deskUpdates: { sales: { title: "DM", value: "12件" } },
    active: { role: "sales", task: "DMを仕分けて返信案を作成", progress: 20 },
  },
  {
    id: "ev16",
    minute: 560,
    log: "セイが返信案の作成を進めている",
    active: { role: "sales", task: "DMを仕分けて返信案を作成", progress: 65 },
  },
  {
    id: "ev17",
    minute: 600,
    log: "今日の記録をアナの席へ",
    handoff: { from: "sales", to: "analytics" },
    deskUpdates: { analytics: { title: "集計", value: "集計中" } },
  },
  {
    id: "ev18",
    minute: 605,
    log: "アナが集計を開始",
    deskUpdates: { analytics: { title: "集計", value: "840 / 36" } },
    active: { role: "analytics", task: "リーチ・フォロワー増減を集計", progress: 40 },
  },
  {
    id: "ev19",
    minute: 650,
    log: "アナが分析メモを作成",
    handoff: { from: "analytics", to: "president" },
    approval: {
      agentName: "アナ",
      title: "本日の分析メモ",
      body: "本日の投稿リーチ840、フォロワー+36、DM対応12件。反応の良かった話題を踏まえ、明日は動画コンテンツを1本追加することを提案します。",
    },
  },
  {
    id: "ev20",
    minute: 660,
    log: "本日の営業終了。お疲れ様でした。",
  },
];

export const SCRIPT_END_MINUTE = TIMELINE_EVENTS[TIMELINE_EVENTS.length - 1]?.minute ?? DAY_END_MINUTE;
