"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ROLES,
  PRESIDENT_POSITION,
  PRESIDENT_AVATAR_SRC,
  PRESIDENT_ALT_AVATAR_SRC,
  DEFAULT_WEBOPS_INPUT,
  buildTimelineEvents,
  scriptEndMinute,
  DAY_START_MINUTE,
  DAY_END_MINUTE,
  formatClock,
  roleByCode,
  type RoleCode,
  type DeskCard,
  type ApprovalItem,
  type TimelineEvent,
  type WebOpsInput,
} from "@/lib/weboffice/script";

/** How many virtual minutes advance per real second while auto-playing. */
const PLAY_SPEED_MINUTES_PER_SECOND = 18;
const TICK_MS = 100;

type FlyingChip = {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  emoji: string;
  avatarSrc?: string;
  altAvatarSrc?: string;
};

type SpeechBubble = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
};

function positionOf(code: RoleCode | "president"): { x: number; y: number } {
  if (code === "president") return PRESIDENT_POSITION;
  return roleByCode(code);
}

/**
 * WEB事業運用オフィス — client-only scripted simulation (spec: 調査分析・
 * リサーチ、制作物作成・画像/動画生成、戦略策定 のイメージデモ)。DBにも
 * 外部APIにも一切接続しない。承認ボタンはUIとして機能するが、この版では
 * 台本の進行自体をブロックしない（見た目の体験を優先）。
 */
export default function WebOpsOffice() {
  const [input, setInput] = useState<WebOpsInput>(DEFAULT_WEBOPS_INPUT);
  const [draft, setDraft] = useState<WebOpsInput>(DEFAULT_WEBOPS_INPUT);
  const [events, setEvents] = useState<TimelineEvent[]>(() => buildTimelineEvents(DEFAULT_WEBOPS_INPUT));
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [extraLog, setExtraLog] = useState<string[]>([]);
  const [approvalModal, setApprovalModal] = useState<ApprovalItem | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [chips, setChips] = useState<FlyingChip[]>([]);
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const prevMinuteRef = useRef(0);

  function startWithInput(nextInput: WebOpsInput) {
    setInput(nextInput);
    setEvents(buildTimelineEvents(nextInput));
    setMinute(0);
    prevMinuteRef.current = 0;
    setChips([]);
    setBubbles([]);
    setExtraLog([]);
    setApprovedIds(new Set());
    setApprovalModal(null);
    setPlaying(true);
  }

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setMinute((m) => {
        const next = m + (PLAY_SPEED_MINUTES_PER_SECOND * TICK_MS) / 1000;
        if (next >= DAY_END_MINUTE) {
          setPlaying(false);
          return DAY_END_MINUTE;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing]);

  // Detect events newly crossed since the last render to trigger hand-off animations.
  useEffect(() => {
    const prev = prevMinuteRef.current;
    if (minute > prev) {
      const crossed = events.filter((e) => e.minute > prev && e.minute <= minute);
      for (const event of crossed) {
        if (event.handoff) {
          const from = positionOf(event.handoff.from);
          const to = positionOf(event.handoff.to);
          const fromRole = event.handoff.from === "president" ? null : roleByCode(event.handoff.from);
          const emoji = fromRole ? fromRole.emoji : "✅";
          const avatarSrc = fromRole ? fromRole.avatarSrc : PRESIDENT_AVATAR_SRC;
          const altAvatarSrc = fromRole ? fromRole.altAvatarSrc : PRESIDENT_ALT_AVATAR_SRC;
          const color = fromRole ? fromRole.color : "#e0c04a";
          const chip: FlyingChip = { id: `${event.id}-chip`, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, emoji, avatarSrc, altAvatarSrc };
          setChips((cur) => [...cur, chip]);
          setTimeout(() => setChips((cur) => cur.filter((c) => c.id !== chip.id)), 1400);

          const bubble: SpeechBubble = { id: `${event.id}-bubble`, x: from.x, y: from.y, text: event.log, color };
          setBubbles((cur) => [...cur, bubble]);
          setTimeout(() => setBubbles((cur) => cur.filter((b) => b.id !== bubble.id)), 1600);
        }
      }
    }
    prevMinuteRef.current = minute;
  }, [minute, events]);

  const roundedMinute = Math.floor(minute);

  const deskCards = useMemo(() => {
    const cards: Partial<Record<RoleCode, DeskCard>> = {};
    for (const event of events) {
      if (event.minute > roundedMinute) break;
      if (event.deskUpdates) Object.assign(cards, event.deskUpdates);
    }
    return cards;
  }, [events, roundedMinute]);

  const activeState = useMemo(() => {
    let latest: TimelineEvent | null = null;
    for (const event of events) {
      if (event.minute > roundedMinute) break;
      if (event.active) latest = event;
    }
    return latest?.active ?? null;
  }, [events, roundedMinute]);

  const latestApproval = useMemo(() => {
    let latest: TimelineEvent | null = null;
    for (const event of events) {
      if (event.minute > roundedMinute) break;
      if (event.approval) latest = event;
    }
    return latest;
  }, [events, roundedMinute]);

  const visibleLog = useMemo(() => events.filter((e) => e.minute <= roundedMinute), [events, roundedMinute]);

  const pendingApprovalCount = latestApproval && !approvedIds.has(latestApproval.id) ? 1 : 0;

  function handleApprove() {
    if (!latestApproval) return;
    setApprovedIds((cur) => new Set(cur).add(latestApproval.id));
    setExtraLog((cur) => [...cur, `あなたが「${latestApproval.approval!.title}」を承認しました`]);
    setApprovalModal(null);
  }

  return (
    <div className="min-h-screen p-4" style={{ background: "#0f1a17", color: "#e8e4d8" }}>
      <style>{`
        @keyframes wo-bob {
          0%, 100% { transform: scale(1.08) translateY(0); }
          50% { transform: scale(1.08) translateY(-4px); }
        }
        .wo-bob { animation: wo-bob 1.1s ease-in-out infinite; }
        @keyframes wo-walk-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .wo-walk-bounce { animation: wo-walk-bounce 0.35s ease-in-out infinite; }
        @keyframes wo-bubble-pop {
          0% { opacity: 0; transform: translate(-50%, -100%) scale(0.6); }
          15% { opacity: 1; transform: translate(-50%, -100%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -100%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -100%) scale(0.9); }
        }
        .wo-bubble-pop { animation: wo-bubble-pop 1.6s ease-in-out forwards; }
      `}</style>
      <div className="mx-auto max-w-5xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Link href="/office" className="text-xs font-semibold" style={{ color: "#9fd6c0" }}>
              ← AI Office
            </Link>
            <h1 className="text-sm font-bold" style={{ color: "#e8e4d8" }}>
              AIエージェント体験ラボ｜AI社員オフィス
              <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#2a3f38", color: "#9fd6c0" }}>
                シミュレーション
              </span>
            </h1>
          </div>
          <span className="font-mono text-lg font-bold">{formatClock(roundedMinute)}</span>
        </div>

        {/* Settings — regenerates the whole day's content around this store/industry/topic */}
        <div className="mb-3 rounded-xl border p-3" style={{ borderColor: "#3a4f47", background: "#16241f" }}>
          <p className="mb-2 text-[11px] font-bold" style={{ color: "#e8e4d8" }}>
            今日の設定
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1.6fr_auto]">
            <input
              value={draft.storeName}
              onChange={(e) => setDraft((d) => ({ ...d, storeName: e.target.value }))}
              placeholder="店舗名"
              className="rounded-lg border px-2 py-1.5 text-[12px] outline-none"
              style={{ borderColor: "#4a6058", background: "#1f332c", color: "#e8e4d8" }}
            />
            <input
              value={draft.industry}
              onChange={(e) => setDraft((d) => ({ ...d, industry: e.target.value }))}
              placeholder="業種"
              className="rounded-lg border px-2 py-1.5 text-[12px] outline-none"
              style={{ borderColor: "#4a6058", background: "#1f332c", color: "#e8e4d8" }}
            />
            <input
              value={draft.topic}
              onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
              placeholder="今日のお題（例：秋の新作メニュー）"
              className="rounded-lg border px-2 py-1.5 text-[12px] outline-none"
              style={{ borderColor: "#4a6058", background: "#1f332c", color: "#e8e4d8" }}
            />
            <button
              onClick={() => startWithInput(draft)}
              disabled={!draft.storeName.trim() || !draft.industry.trim() || !draft.topic.trim()}
              className="rounded-lg px-3 py-1.5 text-[12px] font-bold disabled:opacity-40"
              style={{ background: "#e0c04a", color: "#16241f" }}
            >
              この設定で始める
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px]">
          {/* Office floor */}
          <div className="relative overflow-hidden rounded-xl border p-4" style={{ borderColor: "#3a4f47", background: "#16241f", minHeight: 460 }}>
            <span className="absolute left-3 top-3 text-lg" aria-hidden>
              🪴
            </span>
            <span className="absolute right-3 top-3 text-lg" aria-hidden>
              🪴
            </span>

            <p className="mb-4 text-[11px]" style={{ color: "#9fb3ab" }}>
              {input.storeName}（{input.industry}）のSNS運用 ・ Instagram / Threads
            </p>

            <div className="grid grid-cols-3 gap-4">
              {ROLES.map((role) => {
                const card = deskCards[role.code];
                const isActive = activeState?.role === role.code;
                return (
                  <div key={role.code} className="flex flex-col items-center gap-1.5">
                    <p className="text-[11px]" style={{ color: "#9fb3ab" }}>
                      {role.label}
                    </p>
                    <div
                      className="w-full rounded-lg border px-2 py-1.5 text-center text-[11px] transition-all"
                      style={{
                        borderColor: isActive ? "#e0c04a" : "#4a6058",
                        background: "#1f332c",
                        boxShadow: isActive ? "0 0 0 1px #e0c04a" : undefined,
                      }}
                    >
                      <p className="font-semibold" style={{ color: "#e8e4d8" }}>
                        {card?.title ?? "待機中"}
                      </p>
                      <p style={{ color: "#c9d6cf" }}>{card?.value ?? "―"}</p>
                    </div>
                    <div
                      className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 text-2xl transition-transform ${isActive ? "wo-bob" : ""}`}
                      style={{ borderColor: role.color, background: "#22362f" }}
                      aria-hidden
                    >
                      {role.avatarSrc ? (
                        <Image src={role.avatarSrc} alt="" width={1254} height={1254} className="h-full w-full object-cover" />
                      ) : (
                        role.emoji
                      )}
                    </div>
                    <p className="text-[12px] font-bold" style={{ color: "#e8e4d8" }}>
                      {role.agentName}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* President seat */}
            <div className="mt-6 flex items-center justify-center gap-3">
              <div
                className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2"
                style={{ borderColor: "#e0c04a", background: "#22362f" }}
                aria-hidden
              >
                <Image src={PRESIDENT_AVATAR_SRC} alt="" width={1254} height={1254} className="h-full w-full object-cover" />
              </div>
              <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "#4a6058", background: "#1f332c" }}>
                <p className="font-semibold" style={{ color: "#e8e4d8" }}>
                  社長席 / あなた
                </p>
                <p style={{ color: "#c9d6cf" }}>{pendingApprovalCount > 0 ? "承認待ちがあります" : "承認待ちはありません"}</p>
              </div>
              <button
                onClick={() => latestApproval?.approval && !approvedIds.has(latestApproval.id) && setApprovalModal(latestApproval.approval)}
                disabled={pendingApprovalCount === 0}
                className="rounded-lg px-4 py-2 text-[12px] font-bold disabled:opacity-40"
                style={{ background: pendingApprovalCount > 0 ? "#e0c04a" : "#3a4f47", color: "#16241f" }}
              >
                承認画面
              </button>
              <button
                onClick={() => setExtraLog((cur) => [...cur, "明日の指示を掲示板に残しました（このデモでは保存されません）"])}
                className="rounded-lg border px-3 py-2 text-[11px]"
                style={{ borderColor: "#4a6058", color: "#c9d6cf" }}
              >
                掲示板 / 明日の指示
              </button>
            </div>

            {/* Flying hand-off chips */}
            {chips.map((chip) => (
              <FlyingChipDot key={chip.id} chip={chip} />
            ))}

            {/* Speech bubbles at the moment work is handed off */}
            {bubbles.map((bubble) => (
              <SpeechBubbleTag key={bubble.id} bubble={bubble} />
            ))}
          </div>

          {/* Activity + active task panel */}
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border p-3" style={{ borderColor: "#3a4f47", background: "#16241f" }}>
              <h2 className="mb-2 text-[12px] font-bold" style={{ color: "#e8e4d8" }}>
                いま起きていること
              </h2>
              <div className="max-h-64 space-y-1 overflow-y-auto text-[11px]">
                {[...visibleLog].reverse().map((event) => (
                  <p key={event.id} style={{ color: "#c9d6cf" }}>
                    <span style={{ color: "#7fae7a" }}>{formatClock(event.minute)}</span> {event.log}
                  </p>
                ))}
                {extraLog.map((msg, i) => (
                  <p key={`extra-${i}`} style={{ color: "#e0c04a" }}>
                    {msg}
                  </p>
                ))}
              </div>
            </div>

            {activeState && (
              <div className="rounded-xl border p-3" style={{ borderColor: "#3a4f47", background: "#16241f" }}>
                <p className="text-[12px] font-bold" style={{ color: "#e8e4d8" }}>
                  {roleByCode(activeState.role).agentName} / {roleByCode(activeState.role).label}
                </p>
                <p className="mb-2 text-[11px]" style={{ color: "#c9d6cf" }}>
                  {activeState.task}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#2a3f38" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${activeState.progress}%`, background: "#e0c04a" }} />
                </div>
                <p className="mt-1 text-right text-[10px]" style={{ color: "#9fb3ab" }}>
                  作業中 {activeState.progress}%
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Timeline scrubber */}
        <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "#3a4f47", background: "#16241f" }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold"
              style={{ background: "#e0c04a", color: "#16241f" }}
            >
              {playing ? "一時停止" : minute >= DAY_END_MINUTE ? "最初から" : "再生"}
            </button>
            <span className="text-[11px]" style={{ color: "#9fb3ab" }}>
              06:00
            </span>
            <input
              type="range"
              min={DAY_START_MINUTE}
              max={DAY_END_MINUTE}
              value={roundedMinute}
              onChange={(e) => {
                setPlaying(false);
                setMinute(Number(e.target.value));
              }}
              className="flex-1"
            />
            <span className="text-[11px]" style={{ color: "#9fb3ab" }}>
              22:00
            </span>
          </div>
          {minute >= DAY_END_MINUTE && (
            <button
              onClick={() => startWithInput(input)}
              className="mt-2 w-full rounded-lg border py-1.5 text-[11px]"
              style={{ borderColor: "#4a6058", color: "#c9d6cf" }}
            >
              最初から再生する
            </button>
          )}
        </div>

        <p className="mt-3 text-center text-[10px]" style={{ color: "#5f746c" }}>
          このオフィスは台本によるシミュレーションです。実際の画像生成・動画生成・SNS投稿は行われません（スクリプトは{scriptEndMinute(events)}分時点で終了します）。
        </p>
      </div>

      {approvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setApprovalModal(null)}>
          <div
            className="w-full max-w-md rounded-xl border p-4"
            style={{ borderColor: "#4a6058", background: "#1f332c" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2">
              {roleByCode(approvalModal.role).avatarSrc && (
                <div className="h-9 w-9 overflow-hidden rounded-full border" style={{ borderColor: roleByCode(approvalModal.role).color }}>
                  <Image
                    src={roleByCode(approvalModal.role).avatarSrc!}
                    alt=""
                    width={1254}
                    height={1254}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <p className="text-[11px]" style={{ color: "#9fb3ab" }}>
                {approvalModal.agentName} からの承認依頼
              </p>
            </div>
            <h3 className="mb-2 text-[13px] font-bold" style={{ color: "#e8e4d8" }}>
              {approvalModal.title}
            </h3>
            <p className="mb-3 text-[12px] leading-relaxed" style={{ color: "#c9d6cf" }}>
              {approvalModal.body}
            </p>
            {approvalModal.items && approvalModal.items.length > 0 && (
              <ul className="mb-4 max-h-52 space-y-1.5 overflow-y-auto text-[11px] leading-relaxed">
                {approvalModal.items.map((item, i) => (
                  <li key={i} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "#4a6058", background: "#16241f", color: "#e8e4d8" }}>
                    {item}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setApprovalModal(null)} className="rounded-lg border px-3 py-1.5 text-[11px]" style={{ borderColor: "#4a6058", color: "#c9d6cf" }}>
                閉じる
              </button>
              <button onClick={handleApprove} className="rounded-lg px-3 py-1.5 text-[11px] font-bold" style={{ background: "#e0c04a", color: "#16241f" }}>
                承認する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Renders at `from`, then flips to `to` on the next frame so the CSS
 * transition on left/top (both percentages of the same relatively-positioned
 * office floor container) animates the hand-off across the desk grid.
 */
function FlyingChipDot({ chip }: { chip: FlyingChip }) {
  const [pos, setPos] = useState({ x: chip.fromX, y: chip.fromY });
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setPos({ x: chip.toX, y: chip.toY }));
    return () => cancelAnimationFrame(id);
  }, [chip.toX, chip.toY]);
  // Flip between the two pose frames in step with the walk-bounce for a walking illusion.
  useEffect(() => {
    if (!chip.altAvatarSrc) return;
    const id = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 175);
    return () => clearInterval(id);
  }, [chip.altAvatarSrc]);
  const frameSrc = frame === 1 && chip.altAvatarSrc ? chip.altAvatarSrc : chip.avatarSrc;
  return (
    <span
      className="pointer-events-none absolute z-10 transition-all duration-[1100ms] ease-in-out"
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)" }}
      aria-hidden
    >
      <span
        className="wo-walk-bounce flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-xl shadow-lg"
        style={{ background: frameSrc ? "#22362f" : "transparent", border: frameSrc ? "2px solid #e0c04a" : undefined }}
      >
        {frameSrc ? <Image src={frameSrc} alt="" width={1254} height={1254} className="h-full w-full object-cover" /> : chip.emoji}
      </span>
    </span>
  );
}

/**
 * A short comment-bubble that pops up at the sender's desk the instant work
 * changes hands, echoing the activity-log line for that hand-off.
 */
function SpeechBubbleTag({ bubble }: { bubble: SpeechBubble }) {
  return (
    <div
      className="wo-bubble-pop pointer-events-none absolute z-20 max-w-[150px] rounded-xl border px-2 py-1 text-[10px] font-semibold leading-snug shadow-lg"
      style={{ left: `${bubble.x}%`, top: `${bubble.y - 8}%`, borderColor: bubble.color, background: "#1f332c", color: "#e8e4d8" }}
      aria-hidden
    >
      {bubble.text}
      <span
        className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent"
        style={{ borderTopColor: bubble.color }}
      />
    </div>
  );
}
