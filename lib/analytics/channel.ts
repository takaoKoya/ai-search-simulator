import type { ChannelType } from "@/lib/generated/prisma/client";

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  LINE: "LINE",
  TIKTOK: "TikTok",
  INDEED: "Indeed",
  X: "X",
  INSTAGRAM: "Instagram",
  DIRECT: "直接",
};

/** utm_source → channel. Unknown or missing sources count as DIRECT. */
const SOURCE_ALIASES: Record<string, ChannelType> = {
  line: "LINE",
  tiktok: "TIKTOK",
  indeed: "INDEED",
  x: "X",
  twitter: "X",
  instagram: "INSTAGRAM",
  ig: "INSTAGRAM",
  direct: "DIRECT",
};

export function resolveChannelType(utmSource: string | null | undefined): ChannelType {
  return SOURCE_ALIASES[(utmSource ?? "").trim().toLowerCase()] ?? "DIRECT";
}

/** The text a visitor sends to the LINE official account to start an attributed application. */
export function buildApplyText(jobId: string, channel: ChannelType): string {
  return `応募:${jobId}:${channel}`;
}

const APPLY_TEXT = /^応募[:：]([a-z0-9]+)(?:[:：]([A-Z]+))?$/;

export function parseApplyText(text: string): { jobId: string; channel: ChannelType } | null {
  const m = text.trim().match(APPLY_TEXT);
  if (!m) return null;
  const channel = m[2] && m[2] in CHANNEL_LABELS ? (m[2] as ChannelType) : "DIRECT";
  return { jobId: m[1], channel };
}

/** https://line.me/R/oaMessage/{basicId}/?{text} opens a chat with the text pre-filled. */
export function buildLineEntryUrl(basicId: string, text: string): string {
  const id = basicId.startsWith("@") ? basicId : `@${basicId}`;
  return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(text)}`;
}

/** Calendar date in JST, as a UTC-midnight Date for a Postgres DATE column. */
export function jstDate(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}
