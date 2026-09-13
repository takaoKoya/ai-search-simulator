"use client";

import type { OfficeState } from "@/lib/server/officeState";

export default function CeoSeatCard({ ceoSummary, onOpenInbox }: { ceoSummary: OfficeState["ceoSummary"]; onOpenInbox: () => void }) {
  return (
    <div
      className="w-[194px] shrink-0 rounded-xl border p-3"
      style={{ borderColor: "var(--office-human-accent)", background: "color-mix(in srgb, var(--office-human-accent) 10%, transparent)" }}
    >
      <p className="text-sm font-bold" style={{ color: "var(--office-human-accent)" }}>
        あなた / CEO
      </p>

      <ul className="mt-2 space-y-1 text-[11px]" style={{ color: "var(--office-text-secondary)" }}>
        {ceoSummary.byType.length === 0 && <li>承認待ちはありません</li>}
        {ceoSummary.byType.map((t) => (
          <li key={t.type} className="flex items-center justify-between">
            <span>{t.label}</span>
            <span className="font-bold" style={{ color: "var(--office-text-primary)" }}>
              {t.count}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px]" style={{ color: "var(--office-text-muted)" }}>
        {ceoSummary.estimatedMinutesToday !== null
          ? `今日の確認 約${ceoSummary.estimatedMinutesToday}分`
          : ceoSummary.totalPending > 0
            ? "所要時間: 実績データ不足のため算出不可"
            : ""}
      </p>

      <button
        onClick={onOpenInbox}
        className="mt-3 w-full rounded-lg py-1.5 text-[11px] font-semibold text-white"
        style={{ background: "var(--office-human-accent)" }}
      >
        CEO Inbox{ceoSummary.totalPending > 0 ? ` (${ceoSummary.totalPending})` : ""}
      </button>
    </div>
  );
}
