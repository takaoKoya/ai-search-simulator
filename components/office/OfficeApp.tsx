"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { OfficeState } from "@/lib/server/officeState";
import type { TenantRole } from "@/lib/server/tenant";
import AgentCard, { type AgentCardData } from "@/components/office/AgentCard";
import AgentDrawer from "@/components/office/AgentDrawer";
import CeoInbox from "@/components/office/CeoInbox";
import CeoSeatCard from "@/components/office/CeoSeatCard";
import DepartmentRoom from "@/components/office/DepartmentRoom";
import ActivityFeed from "@/components/office/ActivityFeed";
import Timeline from "@/components/office/Timeline";
import Header, { type NotificationItem } from "@/components/office/Header";
import LeftNav from "@/components/office/LeftNav";
import SalesSettingsPanel from "@/components/office/SalesSettingsPanel";

const POLL_INTERVAL_MS = 4000;

type MobileTab = "agents" | "working" | "approvals" | "activity";
type EnrichedAgent = OfficeState["agents"][number];

function deriveNotifications(state: OfficeState): NotificationItem[] {
  const items: NotificationItem[] = [];
  for (const a of state.pendingApprovals) {
    items.push({ id: `appr-${a.id}`, message: `承認待ち: ${a.title}`, tone: "warning" });
  }
  for (const agent of state.agents) {
    if (agent.status === "failed") items.push({ id: `agent-fail-${agent.id}`, message: `${agent.name}が失敗しました`, tone: "error" });
    else if (agent.status === "warning") items.push({ id: `agent-warn-${agent.id}`, message: `${agent.name}が要確認です`, tone: "warning" });
  }
  for (const e of state.events.slice(0, 30)) {
    if (e.event_type === "contract.risk_detected") {
      items.push({ id: `event-${e.id}`, message: e.message ?? "契約リスクを検出", tone: "warning" });
    }
    if (e.event_type === "delivery.completed") {
      items.push({ id: `event-${e.id}`, message: e.message ?? "納品が完了しました", tone: "info" });
    }
  }
  return items.slice(0, 20);
}

export default function OfficeApp({
  initialState,
  role,
  tenantName,
}: {
  initialState: OfficeState;
  role: TenantRole;
  tenantName: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<OfficeState>(initialState);
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [leadsOpen, setLeadsOpen] = useState(false);
  const [salesSettingsOpen, setSalesSettingsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("agents");
  const [toast, setToast] = useState<string | null>(null);
  const [connectionOk, setConnectionOk] = useState(true);
  const inFlight = useRef(false);
  const projectsSectionRef = useRef<HTMLDivElement | null>(null);

  const canApprove = role === "owner" || role === "ceo" || role === "admin";

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/office/state");
      if (res.ok) {
        setState(await res.json());
        setConnectionOk(true);
      } else {
        setConnectionOk(false);
      }
    } catch {
      setConnectionOk(false);
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

  function toCardData(agent: EnrichedAgent): AgentCardData {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      job_title: agent.job_title,
      status: agent.status,
      avatar: agent.avatar,
      notificationCount: agent.notificationCount,
      currentProjectName: agent.current_project_id ? (projectNameById.get(agent.current_project_id) ?? null) : null,
      currentTaskTitle: agent.current_task_id ? (taskTitleById.get(agent.current_task_id) ?? null) : null,
      progress: agent.current_project_id ? (projectProgressById.get(agent.current_project_id) ?? null) : null,
    };
  }

  const workingAgents = state.agents.filter((a) => a.status !== "idle" && a.status !== "completed");
  const pendingCount = state.pendingApprovals.length;
  const notifications = useMemo(() => deriveNotifications(state), [state]);

  function handleOpenEvent(event: { event_type: string; from_agent_id?: string | null; to_agent_id?: string | null }) {
    if (event.event_type.startsWith("approval.") || event.event_type === "workflow.waiting_human") {
      setInboxOpen(true);
      return;
    }
    const agentId = event.to_agent_id ?? event.from_agent_id;
    if (agentId) setDrawerAgentId(agentId);
  }

  function handleNavigate(key: string) {
    if (key === "office") return;
    if (key === "leads") return setLeadsOpen(true);
    if (key === "approvals") return setInboxOpen(true);
    if (key === "projects") return projectsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setToast("この機能は Coming Soon です");
  }

  return (
    <div className="ai-office min-h-screen bg-[var(--office-bg-primary)] text-[var(--office-text-primary)]">
      <div
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--office-grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--office-grid-line) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <Header
        tenantName={tenantName}
        role={role}
        state={state}
        notifications={notifications}
        onOpenLead={() => setLeadsOpen(true)}
        onOpenAgent={(id) => setDrawerAgentId(id)}
        onOpenApproval={() => setInboxOpen(true)}
        onOpenProject={(id) => router.push(`/office/projects/${id}`)}
      />

      {!connectionOk && (
        <div
          className="relative z-10 px-4 py-1 text-center text-[11px]"
          style={{ background: "color-mix(in srgb, var(--office-status-warning) 20%, transparent)", color: "var(--office-status-warning)" }}
        >
          Realtime disconnected — 再接続を試みています…
        </div>
      )}

      {toast && (
        <div
          className="fixed right-4 top-20 z-50 rounded-lg border px-4 py-2 text-sm shadow-lg"
          style={{ borderColor: "var(--office-status-failed)", background: "var(--office-bg-secondary)", color: "var(--office-status-failed)" }}
        >
          {toast}
        </div>
      )}

      {/* Desktop / tablet layout */}
      <div className="relative z-10 hidden gap-4 p-4 lg:grid lg:h-[calc(100vh-64px)] lg:grid-cols-[72px_1fr_336px] lg:grid-rows-[1fr_72px]">
        <LeftNav activeKey="office" pendingApprovalCount={pendingCount} onNavigate={handleNavigate} />

        <main
          className="overflow-y-auto rounded-xl border p-4"
          style={{ borderColor: "var(--office-border)", background: "color-mix(in srgb, var(--office-surface) 60%, transparent)" }}
        >
          <OfficeBoard
            state={state}
            onSelectAgent={setDrawerAgentId}
            toCardData={toCardData}
            onMeasure={(id) => callApi(`/api/projects/${id}/measure`)}
            onRenew={(id) => callApi(`/api/projects/${id}/renew`)}
            onOpenInbox={() => setInboxOpen(true)}
            projectsSectionRef={projectsSectionRef}
          />
        </main>

        <aside className="row-span-1 overflow-hidden">
          <ActivityFeed events={state.events} onOpenAgent={setDrawerAgentId} onOpenApproval={() => setInboxOpen(true)} />
        </aside>

        <div className="col-start-2 col-end-4">
          <Timeline runs={state.workflowRuns} events={state.events} onOpenEvent={handleOpenEvent} />
        </div>
      </div>

      {/* Mobile layout */}
      <div className="relative z-10 flex flex-col gap-3 p-3 pb-20 lg:hidden">
        {mobileTab === "agents" && (
          <MobileList title="AI社員一覧">
            {state.agents.length === 0 && <EmptyState message="まだAI社員がいません。" />}
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
            {workingAgents.length === 0 && <EmptyState message="現在稼働中のAI社員はいません。" />}
          </MobileList>
        )}
        {mobileTab === "approvals" && (
          <div>
            <button
              onClick={() => setInboxOpen(true)}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ background: "var(--office-human-accent)" }}
            >
              CEO Inboxを開く（承認待ち {pendingCount} 件）
            </button>
          </div>
        )}
        {mobileTab === "activity" && (
          <div className="h-[70vh]">
            <ActivityFeed events={state.events} onOpenAgent={setDrawerAgentId} onOpenApproval={() => setInboxOpen(true)} />
          </div>
        )}
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t lg:hidden"
        style={{ borderColor: "var(--office-border)", background: "color-mix(in srgb, var(--office-bg-secondary) 95%, transparent)" }}
      >
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
            className="flex-1 py-3 text-center text-[11px] font-semibold"
            style={{ color: mobileTab === tab ? "var(--office-ai-accent)" : "var(--office-text-muted)" }}
          >
            {label}
            {tab === "approvals" && pendingCount > 0 && <span style={{ color: "var(--office-status-failed)", marginLeft: 4 }}>({pendingCount})</span>}
          </button>
        ))}
      </nav>

      {drawerAgentId && <AgentDrawer agentId={drawerAgentId} role={role} onClose={() => setDrawerAgentId(null)} />}

      {inboxOpen && (
        <CeoInbox
          approvals={state.approvals}
          onClose={() => setInboxOpen(false)}
          onDecide={async (id, action, reason, editNote) => {
            if (!canApprove) {
              setToast("この操作にはCEO/管理者権限が必要です");
              return;
            }
            await callApi(`/api/approvals/${id}/decide`, { body: JSON.stringify({ action, reason, editNote }) });
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
          onStartDiscovery={async (scenario) => {
            await callApi("/api/sales/discovery-runs", { body: JSON.stringify({ source: "test_fixture", scenario }) });
          }}
          onOpenSettings={() => setSalesSettingsOpen(true)}
        />
      )}

      {salesSettingsOpen && <SalesSettingsPanel onClose={() => setSalesSettingsOpen(false)} />}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm" style={{ color: "var(--office-text-muted)" }}>
      {message}
    </p>
  );
}

function MobileList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--office-text-secondary)" }}>
        {title}
      </h2>
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
  onOpenInbox,
  projectsSectionRef,
}: {
  state: OfficeState;
  onSelectAgent: (id: string) => void;
  toCardData: (agent: EnrichedAgent) => AgentCardData;
  onMeasure: (projectId: string) => void;
  onRenew: (projectId: string) => void;
  onOpenInbox: () => void;
  projectsSectionRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="space-y-4">
      {state.departments.length === 0 && state.unassignedAgents.length === 0 && (
        <div
          className="rounded-xl border border-dashed p-8 text-center text-sm"
          style={{ borderColor: "var(--office-border)", color: "var(--office-text-muted)" }}
        >
          この部署にはまだAI社員がいません。最初のAI社員を追加してください。
        </div>
      )}

      {state.departments.map((dept, idx) => (
        <DepartmentRoom key={dept.id} department={dept} toCardData={toCardData} onSelectAgent={onSelectAgent} defaultExpanded={idx < 4} />
      ))}

      {state.unassignedAgents.length > 0 && (
        <section
          className="rounded-2xl border p-4"
          style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
        >
          <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--office-text-primary)" }}>
            未配属
          </h2>
          <div className="flex flex-wrap gap-3">
            {state.unassignedAgents.map((agent) => (
              <AgentCard key={agent.id} agent={toCardData(agent)} onClick={() => onSelectAgent(agent.id)} />
            ))}
          </div>
        </section>
      )}

      <div ref={projectsSectionRef} className="grid grid-cols-1 gap-4 sm:grid-cols-[194px_1fr]">
        <CeoSeatCard ceoSummary={state.ceoSummary} onOpenInbox={onOpenInbox} />

        {state.projects.length > 0 && (
          <section className="rounded-2xl border p-4" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
            <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--office-text-primary)" }}>
              Projects
            </h2>
            <ul className="space-y-2">
              {state.projects.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[12px]"
                  style={{ borderColor: "var(--office-border)" }}
                >
                  <Link href={`/office/projects/${p.id}`} className="min-w-0 flex-1 hover:underline">
                    <p className="truncate font-semibold" style={{ color: "var(--office-text-primary)" }}>
                      {p.name}
                    </p>
                    <p style={{ color: "var(--office-text-muted)" }}>
                      {p.clientName ?? "クライアント未設定"} ・ {p.status} ・ Task {p.doneTasks}/{p.totalTasks}
                    </p>
                  </Link>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onMeasure(p.id)}
                      className="rounded-md border px-2 py-1 text-[11px]"
                      style={{ borderColor: "var(--office-border)", color: "var(--office-text-secondary)" }}
                    >
                      月次レポート
                    </button>
                    <button
                      onClick={() => onRenew(p.id)}
                      className="rounded-md border px-2 py-1 text-[11px]"
                      style={{ borderColor: "var(--office-border)", color: "var(--office-text-secondary)" }}
                    >
                      継続提案
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function LeadsPanel({
  leads,
  onClose,
  onCreate,
  onStartResearch,
  onStartDiscovery,
  onOpenSettings,
}: {
  leads: OfficeState["leads"];
  onClose: () => void;
  onCreate: (companyName: string, industry: string, website: string) => Promise<void>;
  onStartResearch: (id: string) => Promise<void>;
  onStartDiscovery: (scenario: "A" | "B" | "C") => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [discoveryScenario, setDiscoveryScenario] = useState<"A" | "B" | "C">("A");
  const [discovering, setDiscovering] = useState(false);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-10 flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l p-5 shadow-2xl"
        style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)", color: "var(--office-text-primary)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Leads</h2>
          <div className="flex items-center gap-2">
            <button onClick={onOpenSettings} className="rounded-md px-2 py-1 text-xs" style={{ color: "var(--office-ai-accent)" }}>
              ICP / DNC設定
            </button>
            <button onClick={onClose} className="rounded-md px-2 py-1 text-sm hover:bg-white/10" style={{ color: "var(--office-text-secondary)" }}>
              閉じる
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
          <p className="text-xs font-semibold" style={{ color: "var(--office-text-secondary)" }}>
            AI Sales Department — 案件候補の自動発見
          </p>
          <p className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
            実際の外部検索APIは未接続のため、まずはラベル付きの合成候補（test fixture）1件で市場探索〜スコアリング〜CEO承認までの一連の流れを確認できます。
          </p>
          <div className="flex items-center gap-2">
            <select
              value={discoveryScenario}
              onChange={(e) => setDiscoveryScenario(e.target.value as "A" | "B" | "C")}
              className="rounded-md border p-1.5 text-[12px]"
              style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
            >
              <option value="A">Fixture A（HOT想定）</option>
              <option value="B">Fixture B（WARM想定）</option>
              <option value="C">Fixture C（除外/重複想定）</option>
            </select>
            <button
              disabled={discovering}
              onClick={async () => {
                setDiscovering(true);
                try {
                  await onStartDiscovery(discoveryScenario);
                } finally {
                  setDiscovering(false);
                }
              }}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--office-ai-accent)" }}
            >
              Discoveryを開始
            </button>
          </div>
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
          className="mt-4 space-y-2 rounded-lg border p-3"
          style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
        >
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="企業名（架空企業でOK）"
            className="w-full rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
          />
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="業種"
            className="w-full rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
          />
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="Webサイト（任意）"
            className="w-full rounded-md border p-2 text-sm"
            style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
          />
          <button
            type="submit"
            disabled={submitting || !companyName.trim()}
            className="w-full rounded-md py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--office-ai-accent)" }}
          >
            Leadを作成
          </button>
        </form>

        <ul className="mt-5 space-y-2">
          {leads.map((lead) => (
            <li key={lead.id} className="rounded-lg border p-3" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
              <div className="flex items-center justify-between">
                <Link href={`/office/leads/${lead.id}`} className="font-semibold hover:underline">
                  {lead.company_name}
                </Link>
                <span className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                  {lead.status}
                </span>
              </div>
              <p className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                {lead.industry ?? "業種未設定"}
              </p>
              {lead.status === "new" && (
                <button
                  onClick={() => onStartResearch(lead.id)}
                  className="mt-2 rounded-md px-3 py-1.5 text-[11px] font-semibold text-white"
                  style={{ background: "var(--office-status-working)" }}
                >
                  Research開始
                </button>
              )}
            </li>
          ))}
          {leads.length === 0 && (
            <li className="text-sm" style={{ color: "var(--office-text-muted)" }}>
              まだLeadがありません。
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
