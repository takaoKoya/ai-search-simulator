"use client";

export interface TimelineRun {
  id: string;
  graph_name: string;
  status: string;
  current_node: string | null;
  created_at: string;
  updated_at: string;
}

const GRAPH_LABEL: Record<string, string> = {
  lead_generation_graph: "Lead Generation",
  sales_graph: "Sales",
  contract_graph: "Contract",
  onboarding_graph: "Onboarding",
  execution_graph: "Execution",
  delivery_graph: "Delivery",
  measurement_graph: "Measurement",
  renewal_graph: "Renewal",
};

const STATUS_CLASS: Record<string, string> = {
  running: "border-sky-500/50 text-sky-300",
  waiting_human: "border-amber-500/50 text-amber-300",
  completed: "border-emerald-500/50 text-emerald-300",
  failed: "border-rose-500/50 text-rose-300",
};

export default function Timeline({ runs }: { runs: TimelineRun[] }) {
  const ordered = [...runs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <div className="flex h-full items-center gap-3 overflow-x-auto rounded-xl border border-white/10 bg-slate-900/50 px-4">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-500">Timeline</span>
      {ordered.length === 0 && <span className="text-[12px] text-slate-500">ワークフローの実行はまだありません。</span>}
      {ordered.map((run) => (
        <div key={run.id} className={`flex shrink-0 flex-col rounded-lg border px-3 py-1.5 ${STATUS_CLASS[run.status] ?? "border-white/10 text-slate-300"}`}>
          <span className="text-[11px] font-semibold">
            {new Date(run.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} {GRAPH_LABEL[run.graph_name] ?? run.graph_name}
          </span>
          {run.current_node && <span className="text-[10px] opacity-80">{run.current_node}</span>}
        </div>
      ))}
    </div>
  );
}
