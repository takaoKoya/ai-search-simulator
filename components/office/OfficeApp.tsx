"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeState } from "@/lib/server/officeState";
import type { TenantRole } from "@/lib/server/tenant";
import AgentCard, { type AgentCardData } from "@/components/office/AgentCard";
import AgentDrawer from "@/components/office/AgentDrawer";
import CeoInbox from "@/components/office/CeoInbox";
import ActivityFeed from "@/components/office/ActivityFeed";
import Timeline from "@/components/office/Timeline";

const POLL_INTERVAL_MS = 4000;

type MobileTab = "agents" | "working" | "approvals" | "activity";

export default function OfficeApp({ initialState, role }: { initialState: OfficeState; role: TenantRole }) {
  const [state, setState] = useState<OfficeState>(initialState);
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [leadsOpen, setLeadsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("agents");
  const [toast, setToast] = useState<string | null>(null);
  const inFlight = useRef(false);

  const canApprove = role === "owner" || role === "ceo" || role === "admin";

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/office/state");
      if (res.ok) setState(await res.json());
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  async function callApi(path: string, options?: RequestInit) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast(body.error ?? "エラーが発生しました");
      throw new Error(body.error ?? "request failed");
    }
    await refresh();
    return body;
  }

  const projectNameById = useMemo(() => new Map(state.projects.map((p) => [p.id, p.name])), [state.projects]);
  const taskTitleById = useMemo(() => new Map(state.tasks.map((t) => [t.id, t.title])), [state.tasks]);
  const projectProgressById = useMemo(
    () => new Map(state.projects.map((p) => [p.id, { done: p.doneTasks, total: p.totalTasks }])),
    [state.projects]
  );

  function toCardData(agent: OfficeState["agents"][number]): AgentCardData {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      job_title: agent.job_title,
      status: agent.status,
      currentProjectName: agent.current_project_id ? (projectNameById.get(agent.current_project_id) ?? null) : null,
      currentTaskTitle: agent.current_task_id ? (taskTitleById.get(agent.current_task_id) ?? null) : null,
      progress: agent.current_project_id ? (projectProgressById.get(agent.current_project_id) ?? null) : null,
    };
  }

  const workingAgents = state.agents.filter((a) => a.status !== "idle" && a.status !== "completed");
  const pendingCount = state.pendingApprovals.length;

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <header className="relative z-10 flex h-16 items-center justify-between border-b border-white/10 bg-slate-950/80 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-slate-100">AI Office</span>
          <span className="hidden text-xs text-slate-500 sm:inline">AI Company Operating System — Phase 1</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLeadsOpen(true)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            ＋ 新規Lead
          </button>
          <button
            onClick={() => setInboxOpen(true)}
            className="relative rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
          >
            CEO Seat
            {pendingCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {toast && (
        <div className="fixed right-4 top-20 z-50 rounded-lg border border-rose-500/40 bg-rose-950/90 px-4 py-2 text-sm text-rose-200 shadow-lg">
          {toast}
        </div>
      )}

      {/* Desktop / tablet layout */}
      <div className="relative z-10 hidden gap-4 p-4 lg:grid lg:h-[calc(100vh-64px)] lg:grid-cols-[72px_1fr_336px] lg:grid-rows-[1fr_72px]">
        <nav className="row-span-2 flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-slate-900/50 py-4">
          <NavIcon label="Office" active />
          <NavIcon label="Ops" disabled />
          <NavIcon label="Tech" disabled />
        </nav>

        <main className="overflow-y-auto rounded-xl border border-white/10 bg-slate-900/30 p-4">
          <OfficeBoard state={state} onSelectAgent={setDrawerAgentId} toCardData={toCardData} onMeasure={(id) => callApi(`/api/projects/${id}/measure`)} onRenew={(id) => callApi(`/api/projects/${id}/renew`)} />
        </main>

        <aside className="row-span-1 overflow-hidden">
          <ActivityFeed events={state.events} />
        </aside>

        <div className="col-start-2 col-end-4">
          <Timeline runs={state.workflowRuns} />
        </div>
      </div>

      {/* Mobile layout */}
      <div className="relative z-10 flex flex-col gap-3 p-3 pb-20 lg:hidden">
        {mobileTab === "agents" && (
          <MobileList title="AI社員一覧">
            {state.agents.map((a) => (
              <AgentCard key={a.id} agent={toCardData(a)} onClick={() => setDrawerAgentId(a.id)} />
            ))}
          </MobileList>
        )}
        {mobileTab === "working" && (
          <MobileList title={`稼働中 (${workingAgents.length})`}>
            {workingAgents.map((a) => (
              <AgentCard key={a.id} agent={toCardData(a)} onClick={() => setDrawerAgentId(a.id)} />
            ))}
            {workingAgents.length === 0 && <p className="text-sm text-slate-500">現在稼働中のAI社員はいません。</p>}
          </MobileList>
        )}
        {mobileTab === "approvals" && (
          <div>
            <button onClick={() => setInboxOpen(true)} className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white">
              CEO Inboxを開く（承認待ち {pendingCount} 件）
            </button>
          </div>
        )}
        {mobileTab === "activity" && (
          <div className="h-[70vh]">
            <ActivityFeed events={state.events} />
          </div>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-slate-950/95 lg:hidden">
        {(
          [
            ["agents", "社員一覧"],
            ["working", "稼働中"],
            ["approvals", "承認待ち"],
            ["activity", "Activity"],
          ] as [MobileTab, string][]
        ).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 py-3 text-center text-[11px] font-semibold ${mobileTab === tab ? "text-sky-400" : "text-slate-500"}`}
          >
            {label}
            {tab === "approvals" && pendingCount > 0 && <span className="ml-1 text-rose-400">({pendingCount})</span>}
          </button>
        ))}
      </nav>

      {drawerAgentId && <AgentDrawer agentId={drawerAgentId} onClose={() => setDrawerAgentId(null)} />}

      {inboxOpen && (
        <CeoInbox
          approvals={state.approvals}
          onClose={() => setInboxOpen(false)}
          onDecide={async (id, action, reason) => {
            if (!canApprove) {
              setToast("この操作にはCEO/管理者権限が必要です");
              return;
            }
            await callApi(`/api/approvals/${id}/decide`, { body: JSON.stringify({ action, reason }) });
          }}
        />
      )}

      {leadsOpen && (
        <LeadsPanel
          leads={state.leads}
          onClose={() => setLeadsOpen(false)}
          onCreate={async (companyName, industry, website) => {
            await callApi("/api/leads", { body: JSON.stringify({ companyName, industry, website }) });
          }}
          onStartResearch={async (id) => {
            await callApi(`/api/leads/${id}/start-research`);
          }}
        />
      )}
    </div>
  );
}

function NavIcon({ label, active, disabled }: { label: string; active?: boolean; disabled?: boolean }) {
  return (
    <div
      className={`flex h-11 w-11 flex-col items-center justify-center rounded-lg text-[9px] font-semibold ${
        active ? "bg-sky-600/20 text-sky-300" : disabled ? "text-slate-700" : "text-slate-400"
      }`}
      title={label}
    >
      <span className="mb-0.5 h-2 w-2 rounded-full bg-current" />
      {label}
    </div>
  );
}

function MobileList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold text-slate-300">{title}</h2>
      <div className="flex flex-wrap gap-3">{children}</div>
    </section>
  );
}

function OfficeBoard({
  state,
  onSelectAgent,
  toCardData,
  onMeasure,
  onRenew,
}: {
  state: OfficeState;
  onSelectAgent: (id: string) => void;
  toCardData: (agent: OfficeState["agents"][number]) => AgentCardData;
  onMeasure: (projectId: string) => void;
  onRenew: (projectId: string) => void;
}) {
  return (
    <div className="space-y-6">
      {state.departments.map((dept) => (
        <section key={dept.id}>
          <h2 className="mb-2 text-sm font-bold text-slate-300">{dept.name}</h2>
          <div className="flex flex-wrap gap-3">
            {dept.agents.length === 0 && <p className="text-xs text-slate-600">配属エージェントなし</p>}
            {dept.agents.map((agent) => (
              <AgentCard key={agent.id} agent={toCardData(agent as OfficeState["agents"][number])} onClick={() => onSelectAgent(agent.id as string)} />
            ))}
          </div>
        </section>
      ))}

      {state.unassignedAgents.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-300">未配属</h2>
          <div className="flex flex-wrap gap-3">
            {state.unassignedAgents.map((agent) => (
              <AgentCard key={agent.id} agent={toCardData(agent)} onClick={() => onSelectAgent(agent.id)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-300">CEO</h2>
        <div className="w-[190px] rounded-xl border border-sky-500/30 bg-sky-500/10 p-3">
          <p className="text-sm font-bold text-sky-200">あなた / CEO</p>
          <p className="mt-2 text-[11px] text-slate-300">承認待ち: {state.pendingApprovals.length}件</p>
        </div>
      </section>

      {state.projects.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-300">Projects</h2>
          <ul className="space-y-2">
            {state.projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-[12px]">
                <div>
                  <p className="font-semibold text-slate-200">{p.name}</p>
                  <p className="text-slate-500">
                    {p.status} ・ Task {p.doneTasks}/{p.totalTasks}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onMeasure(p.id)} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">
                    月次レポート
                  </button>
                  <button onClick={() => onRenew(p.id)} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">
                    継続提案
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LeadsPanel({
  leads,
  onClose,
  onCreate,
  onStartResearch,
}: {
  leads: OfficeState["leads"];
  onClose: () => void;
  onCreate: (companyName: string, industry: string, website: string) => Promise<void>;
  onStartResearch: (id: string) => Promise<void>;
}) {
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l border-white/10 bg-slate-950 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Leads</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-white/10 hover:text-white">
            閉じる
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!companyName.trim()) return;
            setSubmitting(true);
            try {
              await onCreate(companyName.trim(), industry.trim(), website.trim());
              setCompanyName("");
              setIndustry("");
              setWebsite("");
            } finally {
              setSubmitting(false);
            }
          }}
          className="mt-4 space-y-2 rounded-lg border border-white/10 bg-slate-900/60 p-3"
        >
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="企業名（架空企業でOK）"
            className="w-full rounded-md border border-white/10 bg-slate-950 p-2 text-sm placeholder:text-slate-500"
          />
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="業種"
            className="w-full rounded-md border border-white/10 bg-slate-950 p-2 text-sm placeholder:text-slate-500"
          />
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="Webサイト（任意）"
            className="w-full rounded-md border border-white/10 bg-slate-950 p-2 text-sm placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={submitting || !companyName.trim()}
            className="w-full rounded-md bg-sky-600 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            Leadを作成
          </button>
        </form>

        <ul className="mt-5 space-y-2">
          {leads.map((lead) => (
            <li key={lead.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-100">{lead.company_name}</p>
                <span className="text-[11px] text-slate-400">{lead.status}</span>
              </div>
              <p className="text-[11px] text-slate-500">{lead.industry ?? "業種未設定"}</p>
              {lead.status === "new" && (
                <button
                  onClick={() => onStartResearch(lead.id)}
                  className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                >
                  Research開始
                </button>
              )}
            </li>
          ))}
          {leads.length === 0 && <li className="text-sm text-slate-500">まだLeadがありません。</li>}
        </ul>
      </div>
    </div>
  );
}
