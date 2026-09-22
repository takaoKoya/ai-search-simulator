"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ROLES,
  PRESIDENT_POSITION,
  TIMELINE_EVENTS,
  DAY_START_MINUTE,
  DAY_END_MINUTE,
  SCRIPT_END_MINUTE,
  formatClock,
  roleByCode,
  type RoleCode,
  type DeskCard,
  type ApprovalItem,
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
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [extraLog, setExtraLog] = useState<string[]>([]);
  const [approvalModal, setApprovalModal] = useState<ApprovalItem | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [chips, setChips] = useState<FlyingChip[]>([]);
  const prevMinuteRef = useRef(0);

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
      const crossed = TIMELINE_EVENTS.filter((e) => e.minute > prev && e.minute <= minute);
      for (const event of crossed) {
        if (event.handoff) {
          const from = positionOf(event.handoff.from);
          const to = positionOf(event.handoff.to);
          const fromRole = event.handoff.from === "president" ? null : roleByCode(event.handoff.from);
          const emoji = fromRole ? fromRole.emoji : "✅";
          const chip: FlyingChip = { id: `${event.id}-chip`, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, emoji, avatarSrc: fromRole?.avatarSrc };
          setChips((cur) => [...cur, chip]);
          setTimeout(() => setChips((cur) => cur.filter((c) => c.id !== chip.id)), 1400);
        }
      }
    }
    prevMinuteRef.current = minute;
  }, [minute]);

  const roundedMinute = Math.floor(minute);

  const deskCards = useMemo(() => {
    const cards: Partial<Record<RoleCode, DeskCard>> = {};
    for (const event of TIMELINE_EVENTS) {
      if (event.minute > roundedMinute) break;
      if (event.deskUpdates) Object.assign(cards, event.deskUpdates);
    }
    return cards;
  }, [roundedMinute]);

  const activeState = useMemo(() => {
    let latest: (typeof TIMELINE_EVENTS)[number] | null = null;
    for (const event of TIMELINE_EVENTS) {
      if (event.minute > roundedMinute) break;
      if (event.active) latest = event;
    }
    return latest?.active ?? null;
  }, [roundedMinute]);

  const latestApproval = useMemo(() => {
    let latest: (typeof TIMELINE_EVENTS)[number] | null = null;
    for (const event of TIMELINE_EVENTS) {
      if (event.minute > roundedMinute) break;
      if (event.approval) latest = event;
    }
    return latest;
  }, [roundedMinute]);

  const visibleLog = useMemo(() => TIMELINE_EVENTS.filter((e) => e.minute <= roundedMinute), [roundedMinute]);

  const pendingApprovalCount = latestApproval && !approvedIds.has(latestApproval.id) ? 1 : 0;

  function handleApprove() {
    if (!latestApproval) return;
    setApprovedIds((cur) => new Set(cur).add(latestApproval.id));
    setExtraLog((cur) => [...cur, `あなたが「${latestApproval.approval!.title}」を承認しました`]);
    setApprovalModal(null);
  }

  return (
    <div className="min-h-screen p-4" style={{ background: "#0f1a17", color: "#e8e4d8" }}>
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
              お店のSNS運用 ・ Instagram / Threads
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
                      className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 text-2xl transition-transform"
                      style={{ borderColor: role.color, background: "#22362f", transform: isActive ? "scale(1.08)" : "scale(1)" }}
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
              onClick={() => {
                setMinute(0);
                setChips([]);
                setPlaying(true);
              }}
              className="mt-2 w-full rounded-lg border py-1.5 text-[11px]"
              style={{ borderColor: "#4a6058", color: "#c9d6cf" }}
            >
              最初から再生する
            </button>
          )}
        </div>

        <p className="mt-3 text-center text-[10px]" style={{ color: "#5f746c" }}>
          このオフィスは台本によるシミュレーションです。実際の画像生成・動画生成・SNS投稿は行われません（スクリプトは{SCRIPT_END_MINUTE}分時点で終了します）。
        </p>
      </div>

      {approvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setApprovalModal(null)}>
          <div
            className="w-full max-w-sm rounded-xl border p-4"
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
            <p className="mb-4 text-[12px] leading-relaxed" style={{ color: "#c9d6cf" }}>
              {approvalModal.body}
            </p>
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
  useEffect(() => {
    const id = requestAnimationFrame(() => setPos({ x: chip.toX, y: chip.toY }));
    return () => cancelAnimationFrame(id);
  }, [chip.toX, chip.toY]);
  return (
    <span
      className="pointer-events-none absolute z-10 flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-xl shadow-lg transition-all duration-[1100ms] ease-in-out"
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)", background: chip.avatarSrc ? "#22362f" : "transparent" }}
      aria-hidden
    >
      {chip.avatarSrc ? <Image src={chip.avatarSrc} alt="" width={1254} height={1254} className="h-full w-full object-cover" /> : chip.emoji}
    </span>
  );
}
