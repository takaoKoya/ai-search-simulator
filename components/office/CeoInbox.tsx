"use client";

import { useState } from "react";

export interface InboxApproval {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  title: string;
  description: string | null;
  risk_level: string | null;
  ai_recommendation: string | null;
  status: string;
  created_at: string;
  subjectLabel?: string | null;
  amount?: number | null;
  urgency?: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
}

const TYPE_LABEL: Record<string, string> = {
  sales_outreach: "営業承認",
  contract_approval: "契約承認",
  delivery: "納品承認",
};

const RISK_VAR: Record<string, string> = {
  LOW: "--office-status-completed",
  MEDIUM: "--office-status-warning",
  HIGH: "--office-status-failed",
  CRITICAL: "--office-status-failed",
};

const URGENCY_VAR: Record<string, string> = {
  CRITICAL: "--office-status-failed",
  HIGH: "--office-status-warning",
  NORMAL: "--office-ai-accent",
  LOW: "--office-text-muted",
};

const URGENCY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export default function CeoInbox({
  approvals,
  onDecide,
  onClose,
}: {
  approvals: InboxApproval[];
  onDecide: (id: string, action: "approve" | "reject" | "revise", reason?: string, editNote?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [openReasonFor, setOpenReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [openEditFor, setOpenEditFor] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = [...approvals.filter((a) => a.status === "pending")].sort(
    (a, b) => (URGENCY_ORDER[a.urgency ?? "LOW"] ?? 3) - (URGENCY_ORDER[b.urgency ?? "LOW"] ?? 3)
  );

  async function handle(id: string, action: "approve" | "reject" | "revise", withReason?: string, withEditNote?: string) {
    setBusyId(id);
    try {
      await onDecide(id, action, withReason, withEditNote);
      setOpenReasonFor(null);
      setReason("");
      setOpenEditFor(null);
      setEditNote("");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-10 flex h-full w-full max-w-[640px] flex-col overflow-y-auto border-l p-5 shadow-2xl"
        style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)", color: "var(--office-text-primary)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">CEO Inbox</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm hover:bg-white/10" style={{ color: "var(--office-text-secondary)" }}>
            閉じる
          </button>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--office-text-muted)" }}>
          承認待ち {pending.length} 件（緊急度順）
        </p>

        <ul className="mt-4 space-y-3">
          {pending.length === 0 && (
            <li className="rounded-xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--office-border)", color: "var(--office-text-muted)" }}>
              承認待ちはありません
            </li>
          )}
          {pending.map((a) => (
            <li key={a.id} className="rounded-xl border p-4" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: "color-mix(in srgb, var(--office-ai-accent) 15%, transparent)", color: "var(--office-ai-accent)" }}
                >
                  {TYPE_LABEL[a.type] ?? a.type}
                </span>
                {a.urgency && (
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: `var(${URGENCY_VAR[a.urgency]})` }}>
                    {a.urgency}
                  </span>
                )}
                {a.risk_level && (
                  <span className="text-[11px] font-semibold" style={{ color: `var(${RISK_VAR[a.risk_level] ?? "--office-text-muted"})` }}>
                    Risk: {a.risk_level}
                  </span>
                )}
              </div>

              <h3 className="mt-2 font-semibold">{a.title}</h3>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]" style={{ color: "var(--office-text-secondary)" }}>
                {a.subjectLabel && (
                  <div className="col-span-2 flex gap-1">
                    <dt style={{ color: "var(--office-text-muted)" }}>会社/案件:</dt>
                    <dd>{a.subjectLabel}</dd>
                  </div>
                )}
                {typeof a.amount === "number" && (
                  <div className="flex gap-1">
                    <dt style={{ color: "var(--office-text-muted)" }}>想定金額:</dt>
                    <dd>¥{a.amount.toLocaleString()}</dd>
                  </div>
                )}
                <div className="flex gap-1">
                  <dt style={{ color: "var(--office-text-muted)" }}>依頼日時:</dt>
                  <dd>{new Date(a.created_at).toLocaleString("ja-JP")}</dd>
                </div>
              </dl>

              {a.description && (
                <p className="mt-2 whitespace-pre-line text-[13px]" style={{ color: "var(--office-text-secondary)" }}>
                  {a.description}
                </p>
              )}
              {a.ai_recommendation && (
                <p className="mt-2 text-[12px]" style={{ color: "var(--office-text-secondary)" }}>
                  AI推奨: {a.ai_recommendation}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={busyId === a.id}
                  onClick={() => handle(a.id, "approve")}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                  style={{ background: "var(--office-status-completed)" }}
                >
                  Approve
                </button>
                <button
                  disabled={busyId === a.id}
                  onClick={() => {
                    setOpenEditFor(openEditFor === a.id ? null : a.id);
                    setOpenReasonFor(null);
                  }}
                  className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                  style={{ borderColor: "var(--office-border)", color: "var(--office-text-primary)" }}
                >
                  Edit and Approve
                </button>
                <button
                  disabled={busyId === a.id}
                  onClick={() => {
                    setOpenReasonFor(openReasonFor === a.id ? null : a.id);
                    setOpenEditFor(null);
                  }}
                  className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                  style={{ borderColor: "var(--office-border)", color: "var(--office-text-secondary)" }}
                >
                  Reject / Request Revision
                </button>
              </div>

              {openEditFor === a.id && (
                <div className="mt-3 space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}>
                  <textarea
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    placeholder="修正メモ（例: 料金は据え置きで先方に伝える）。承認は現状の内容のまま行われ、メモはDecision Memoryに残ります。"
                    className="w-full rounded-md border p-2 text-[12px]"
                    style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
                    rows={2}
                  />
                  <button
                    disabled={busyId === a.id}
                    onClick={() => handle(a.id, "approve", undefined, editNote)}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--office-status-completed)" }}
                  >
                    メモを保存してApprove
                  </button>
                </div>
              )}

              {openReasonFor === a.id && (
                <div className="mt-3 space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="却下・差し戻し理由（必須・Decision Memoryとして保存されます）"
                    className="w-full rounded-md border p-2 text-[12px]"
                    style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === a.id || !reason.trim()}
                      onClick={() => handle(a.id, "revise", reason)}
                      className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                      style={{ background: "var(--office-status-waiting-human)" }}
                    >
                      Request Revision
                    </button>
                    <button
                      disabled={busyId === a.id || !reason.trim()}
                      onClick={() => handle(a.id, "reject", reason)}
                      className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                      style={{ background: "var(--office-status-failed)" }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
            履歴
          </h3>
          <ul className="space-y-1">
            {approvals
              .filter((a) => a.status !== "pending")
              .slice(0, 10)
              .map((a) => (
                <li key={a.id} className="text-[12px]" style={{ color: "var(--office-text-muted)" }}>
                  {TYPE_LABEL[a.type] ?? a.type} — {a.title}:{" "}
                  <span
                    style={{
                      color:
                        a.status === "approved"
                          ? "var(--office-status-completed)"
                          : a.status === "rejected"
                            ? "var(--office-status-failed)"
                            : "var(--office-status-warning)",
                    }}
                  >
                    {a.status}
                  </span>
                </li>
              ))}
            {approvals.filter((a) => a.status !== "pending").length === 0 && (
              <li className="text-[12px]" style={{ color: "var(--office-text-muted)" }}>
                まだ履歴はありません
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
