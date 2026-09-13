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
}

const TYPE_LABEL: Record<string, string> = {
  sales_outreach: "営業承認",
  contract_approval: "契約承認",
  delivery: "納品承認",
};

const RISK_CLASS: Record<string, string> = {
  LOW: "text-emerald-400",
  MEDIUM: "text-amber-400",
  HIGH: "text-orange-400",
  CRITICAL: "text-rose-400",
};

export default function CeoInbox({
  approvals,
  onDecide,
  onClose,
}: {
  approvals: InboxApproval[];
  onDecide: (id: string, action: "approve" | "reject" | "revise", reason?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [openReasonFor, setOpenReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = approvals.filter((a) => a.status === "pending");

  async function handle(id: string, action: "approve" | "reject" | "revise", withReason?: string) {
    setBusyId(id);
    try {
      await onDecide(id, action, withReason);
      setOpenReasonFor(null);
      setReason("");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-[640px] flex-col overflow-y-auto border-l border-white/10 bg-slate-950 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">CEO Inbox</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-white/10 hover:text-white">
            閉じる
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">承認待ち {pending.length} 件（優先度順: 新しい依頼が上）</p>

        <ul className="mt-4 space-y-3">
          {pending.length === 0 && <li className="text-sm text-slate-500">承認待ちの案件はありません。</li>}
          {pending.map((a) => (
            <li key={a.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                  {TYPE_LABEL[a.type] ?? a.type}
                </span>
                {a.risk_level && <span className={`text-[11px] font-semibold ${RISK_CLASS[a.risk_level] ?? "text-slate-400"}`}>Risk: {a.risk_level}</span>}
              </div>
              <h3 className="mt-2 font-semibold text-slate-100">{a.title}</h3>
              {a.description && <p className="mt-1 whitespace-pre-line text-[13px] text-slate-400">{a.description}</p>}
              {a.ai_recommendation && <p className="mt-2 text-[12px] text-slate-300">AI推奨: {a.ai_recommendation}</p>}
              <p className="mt-1 text-[11px] text-slate-500">依頼日時: {new Date(a.created_at).toLocaleString("ja-JP")}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={busyId === a.id}
                  onClick={() => handle(a.id, "approve")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busyId === a.id}
                  onClick={() => setOpenReasonFor(openReasonFor === a.id ? null : a.id)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                >
                  Reject / Request Revision
                </button>
              </div>

              {openReasonFor === a.id && (
                <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-slate-950 p-3">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="却下・差し戻し理由（Decision Memoryとして保存されます）"
                    className="w-full rounded-md border border-white/10 bg-slate-900 p-2 text-[12px] text-slate-100 placeholder:text-slate-500"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === a.id}
                      onClick={() => handle(a.id, "revise", reason)}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                    >
                      Request Revision
                    </button>
                    <button
                      disabled={busyId === a.id}
                      onClick={() => handle(a.id, "reject", reason)}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
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
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">履歴</h3>
          <ul className="space-y-1">
            {approvals
              .filter((a) => a.status !== "pending")
              .slice(0, 10)
              .map((a) => (
                <li key={a.id} className="text-[12px] text-slate-500">
                  {TYPE_LABEL[a.type] ?? a.type} — {a.title}:{" "}
                  <span
                    className={a.status === "approved" ? "text-emerald-400" : a.status === "rejected" ? "text-rose-400" : "text-amber-400"}
                  >
                    {a.status}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
