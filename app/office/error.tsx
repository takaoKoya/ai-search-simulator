"use client";

import { useEffect } from "react";

/**
 * Next.js route-segment error boundary for /office and everything nested
 * under it (e.g. /office/projects/[id]). An unexpected client exception here
 * shows a scoped recovery screen instead of taking down the whole app —
 * spec #34: エラー時に画面全体を落とさない.
 */
export default function OfficeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="ai-office flex min-h-screen items-center justify-center bg-[var(--office-bg-primary)] p-6 text-[var(--office-text-primary)]">
      <div className="max-w-md rounded-xl border p-6 text-center" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
        <p className="text-sm font-bold" style={{ color: "var(--office-status-failed)" }}>
          AI Officeの表示中に問題が発生しました
        </p>
        <p className="mt-2 text-[12px]" style={{ color: "var(--office-text-secondary)" }}>
          {error.message || "予期しないエラーです。"}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg px-4 py-2 text-[12px] font-semibold text-white"
          style={{ background: "var(--office-ai-accent)" }}
        >
          再読み込み
        </button>
      </div>
    </div>
  );
}
