export const STATUS_LABEL: Record<string, string> = {
  idle: "待機中",
  queued: "順番待ち",
  thinking: "思考中",
  working: "作業中",
  tool_calling: "ツール実行中",
  waiting_external: "外部待ち",
  waiting_human: "人間承認待ち",
  reviewing: "レビュー中",
  handoff: "引き継ぎ中",
  completed: "完了",
  warning: "要確認",
  failed: "失敗",
};

export const STATUS_DOT_CLASS: Record<string, string> = {
  idle: "bg-slate-500",
  queued: "bg-slate-400",
  thinking: "bg-sky-400",
  working: "bg-sky-400 animate-pulse",
  tool_calling: "bg-cyan-400 animate-pulse",
  waiting_external: "bg-amber-400",
  waiting_human: "bg-amber-400 animate-pulse",
  reviewing: "bg-violet-400",
  handoff: "bg-teal-400",
  completed: "bg-emerald-400",
  warning: "bg-amber-400",
  failed: "bg-rose-500",
};

export const STATUS_TEXT_CLASS: Record<string, string> = {
  idle: "text-slate-400",
  queued: "text-slate-400",
  thinking: "text-sky-300",
  working: "text-sky-300",
  tool_calling: "text-cyan-300",
  waiting_external: "text-amber-300",
  waiting_human: "text-amber-300",
  reviewing: "text-violet-300",
  handoff: "text-teal-300",
  completed: "text-emerald-300",
  warning: "text-amber-300",
  failed: "text-rose-400",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
