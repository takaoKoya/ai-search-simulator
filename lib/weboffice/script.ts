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
  /** Character illustration shown on the desk avatar and hand-off animation; falls back to `emoji` when absent. */
  avatarSrc?: string;
  /** Alternate pose used to flip-animate a "walk" during the hand-off flight; falls back to `avatarSrc` when absent. */
  altAvatarSrc?: string;
  color: string;
  /** Grid position as a percentage of the office floor container. */
  x: number;
  y: number;
}

export const PRESIDENT_POSITION = { x: 50, y: 92 };
export const PRESIDENT_AVATAR_SRC = "/weboffice/characters/president.webp";
export const PRESIDENT_ALT_AVATAR_SRC = "/weboffice/characters/president-b.webp";

export const ROLES: Role[] = [
  {
    code: "research",
    label: "リサーチ",
    agentName: "リサ",
    emoji: "🔍",
    avatarSrc: "/weboffice/characters/research.webp",
    altAvatarSrc: "/weboffice/characters/research-b.webp",
    color: "#7fae7a",
    x: 16,
    y: 24,
  },
  {
    code: "writing",
    label: "執筆",
    agentName: "カク",
    emoji: "✍️",
    avatarSrc: "/weboffice/characters/writing.webp",
    altAvatarSrc: "/weboffice/characters/writing-b.webp",
    color: "#c9a25a",
    x: 50,
    y: 24,
  },
  {
    code: "ops",
    label: "運用",
    agentName: "ラン",
    emoji: "📮",
    avatarSrc: "/weboffice/characters/ops.webp",
    altAvatarSrc: "/weboffice/characters/ops-b.webp",
    color: "#d98a5f",
    x: 84,
    y: 24,
  },
  {
    code: "production",
    label: "制作",
    agentName: "サク",
    emoji: "🎨",
    avatarSrc: "/weboffice/characters/production.webp",
    altAvatarSrc: "/weboffice/characters/production-b.webp",
    color: "#e0c04a",
    x: 16,
    y: 60,
  },
  {
    code: "sales",
    label: "営業",
    agentName: "セイ",
    emoji: "💬",
    avatarSrc: "/weboffice/characters/sales.webp",
    altAvatarSrc: "/weboffice/characters/sales-b.webp",
    color: "#6c9fc9",
    x: 50,
    y: 60,
  },
  {
    code: "analytics",
    label: "分析",
    agentName: "アナ",
    emoji: "📊",
    avatarSrc: "/weboffice/characters/analytics.webp",
    altAvatarSrc: "/weboffice/characters/analytics-b.webp",
    color: "#a988c9",
    x: 84,
    y: 60,
  },
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
  role: RoleCode;
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

export interface WebOpsInput {
  storeName: string;
  industry: string;
  topic: string;
}

export const DEFAULT_WEBOPS_INPUT: WebOpsInput = {
  storeName: "サンプル店舗",
  industry: "飲食店",
  topic: "今週のおすすめメニュー",
};

// Deterministic pseudo-randomness seeded from the input strings, so the same
// store/industry/topic always yields the same generated day (reproducible,
// no Math.random()) — same approach as lib/ai/provider.ts's seededScore().
function seededScore(seed: string, min: number, max: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = (hash >>> 0) / 0xffffffff;
  return Math.round(min + normalized * (max - min));
}

/**
 * Builds a full day's timeline, personalized from the given store/industry/
 * topic input. The narrative beats, timing, hand-offs and animations stay
 * fixed — only the generated text and the counts embedded in it change, via
 * seeded pseudo-randomness so the same input always regenerates identically.
 */
export function buildTimelineEvents(input: WebOpsInput): TimelineEvent[] {
  const seed = `${input.storeName}|${input.industry}|${input.topic}`;
  const postCount = seededScore(`${seed}|posts`, 3, 6);
  const overnightPosts = seededScore(`${seed}|overnight`, 12, 40);
  const dmCount = seededScore(`${seed}|dm`, 5, 20);
  const reach = seededScore(`${seed}|reach`, 300, 2000);
  const followerDelta = seededScore(`${seed}|followers`, 5, 80);

  return [
    {
      id: "ev1",
      minute: 0,
      log: `リサが「${input.topic}」の話題を集め始めた`,
      deskUpdates: { research: { title: "話題", value: "収集中" } },
      active: { role: "research", task: `${input.industry}のSNSトレンドと競合投稿を収集`, progress: 15 },
    },
    {
      id: "ev2",
      minute: 4,
      log: `昨夜の投稿${overnightPosts}件を確認`,
      deskUpdates: { research: { title: "話題", value: `${overnightPosts}件` } },
      active: { role: "research", task: "今日のネタを3行に要約", progress: 60 },
    },
    {
      id: "ev3",
      minute: 40,
      log: `リサが「${input.topic}」を3行に要約`,
      deskUpdates: { research: { title: "話題", value: "3行要約" } },
      handoff: { from: "research", to: "writing" },
      active: { role: "writing", task: "投稿文の下書きを作成", progress: 10 },
    },
    {
      id: "ev4",
      minute: 90,
      log: `カクが${input.storeName}向けの投稿文を執筆中`,
      deskUpdates: { writing: { title: "投稿文", value: "執筆中" } },
      active: { role: "writing", task: `投稿文${postCount}本のドラフト作成`, progress: 55 },
    },
    {
      id: "ev5",
      minute: 150,
      log: `カクが投稿案${postCount}本を仕上げた`,
      deskUpdates: { writing: { title: "投稿文", value: `台本${postCount}本` } },
      handoff: { from: "writing", to: "president" },
      approval: {
        agentName: "カク",
        role: "writing",
        title: `投稿案${postCount}本の確認`,
        body: `「${input.topic}」をテーマにしたInstagram/Threads投稿案を${postCount}本作成しました。${input.storeName}（${input.industry}）のトーンに合わせています。内容をご確認の上、承認をお願いします（このデモでは実際には投稿されません）。`,
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
      log: `ランが${input.storeName}の予約投稿を実行`,
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
      log: `セイが届いたDM${dmCount}件を確認`,
      deskUpdates: { sales: { title: "DM", value: `${dmCount}件` } },
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
      deskUpdates: { analytics: { title: "集計", value: `${reach} / ${followerDelta}` } },
      active: { role: "analytics", task: "リーチ・フォロワー増減を集計", progress: 40 },
    },
    {
      id: "ev19",
      minute: 650,
      log: "アナが分析メモを作成",
      handoff: { from: "analytics", to: "president" },
      approval: {
        agentName: "アナ",
        role: "analytics",
        title: "本日の分析メモ",
        body: `本日の投稿リーチ${reach}、フォロワー+${followerDelta}、DM対応${dmCount}件。反応の良かった「${input.topic}」を踏まえ、明日は動画コンテンツを1本追加することを提案します。`,
      },
    },
    {
      id: "ev20",
      minute: 660,
      log: `${input.storeName}の本日の運用終了。お疲れ様でした。`,
    },
  ];
}

export const TIMELINE_EVENTS: TimelineEvent[] = buildTimelineEvents(DEFAULT_WEBOPS_INPUT);

export function scriptEndMinute(events: TimelineEvent[]): number {
  return events[events.length - 1]?.minute ?? DAY_END_MINUTE;
}

export const SCRIPT_END_MINUTE = scriptEndMinute(TIMELINE_EVENTS);
