"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LeadDetailState } from "@/lib/server/leadDetail";
import type { TenantRole } from "@/lib/server/tenant";

const POLL_INTERVAL_MS = 5000;

const DISCOVERY_STAGE_LABEL: Record<string, string> = {
  DISCOVERED: "発見",
  RESEARCHING: "調査中",
  SCORING: "スコアリング中",
  QUALIFIED: "案件化可能性あり",
  CRITIC_REVIEW: "Criticレビュー中",
  APPROVAL_PENDING: "CEO承認待ち",
  READY_FOR_OUTREACH: "営業準備完了",
  CONTACTED: "接触済み",
  RESPONDED: "返信あり",
  MEETING: "商談中",
  PROPOSAL: "提案中",
  NEGOTIATION: "交渉中",
  WON: "受注",
  LOST: "失注",
  ON_HOLD: "保留",
  BLOCKED: "ブロック",
  REJECTED: "却下",
  ARCHIVED: "アーカイブ",
};

const QUALIFICATION_VAR: Record<string, string> = {
  HOT: "--office-status-failed",
  WARM: "--office-status-warning",
  NURTURE: "--office-ai-accent",
  LOW: "--office-text-muted",
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "research", label: "Research" },
  { key: "website", label: "Website Analysis" },
  { key: "score", label: "Score" },
  { key: "strategy", label: "Sales Strategy" },
  { key: "outreach", label: "Outreach" },
  { key: "evidence", label: "Evidence" },
  { key: "activity", label: "Activity" },
  { key: "approvals", label: "Approvals" },
  { key: "history", label: "History" },
] as const;

const MESSAGE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  WAITING_REVIEW: "Critic確認中",
  WAITING_APPROVAL: "CEO承認待ち",
  APPROVED: "承認済み",
  READY_TO_SEND: "送信準備完了",
  SENT: "送信済み",
  DELIVERED: "配信済み",
  REPLIED: "返信あり",
  FAILED: "送信失敗",
  BOUNCED: "不達",
  CANCELLED: "キャンセル",
};
type TabKey = (typeof TABS)[number]["key"];

export default function LeadDetail({
  leadId,
  initialState,
  role,
}: {
  leadId: string;
  initialState: LeadDetailState;
  role: TenantRole;
}) {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<TabKey>("overview");
  const [toast, setToast] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ id: string; action: "reject" | "revise" | "do_not_contact" } | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparingOutreach, setPreparingOutreach] = useState(false);
  const [replyDraftText, setReplyDraftText] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const canApprove = role === "owner" || role === "ceo" || role === "admin";

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/leads/${leadId}/detail`);
      if (res.ok) setState(await res.json());
    } finally {
      inFlight.current = false;
    }
  }, [leadId]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function decide(approvalId: string, action: "approve" | "reject" | "revise" | "hold" | "do_not_contact", withReason?: string) {
    if (!canApprove) {
      setToast("この操作にはCEO/管理者権限が必要です");
      return;
    }
    setBusyId(approvalId);
    try {
      const res = await fetch(`/api/approvals/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: withReason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(body.error ?? "エラーが発生しました");
        return;
      }
      setReasonFor(null);
      setReason("");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function prepareOutreach() {
    setPreparingOutreach(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/prepare-outreach`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(body.error ?? "エラーが発生しました");
        return;
      }
      await refresh();
    } finally {
      setPreparingOutreach(false);
    }
  }

  async function sendMessage(messageId: string) {
    setBusyId(messageId);
    try {
      const res = await fetch(`/api/sales-messages/${messageId}/send`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(body.error ?? "送信に失敗しました");
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function simulateReply(messageId: string) {
    const replyText = (replyDraftText[messageId] ?? "").trim();
    if (!replyText) return;
    setBusyId(messageId);
    try {
      const res = await fetch(`/api/sales-messages/${messageId}/simulate-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(body.error ?? "エラーが発生しました");
        return;
      }
      setReplyDraftText((prev) => ({ ...prev, [messageId]: "" }));
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const { scores, latestScore, latestHypothesis } = state;
  const lead = state.lead as Record<string, unknown>;
  const findings = state.findings as Array<{ id: string; type: string; payload: Record<string, unknown>; created_at: string }>;
  const events = state.events as Array<{
    id: string;
    event_type: string;
    message: string | null;
    from_agent_id: string | null;
    to_agent_id: string | null;
    created_at: string;
  }>;
  const approvals = state.approvals as Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    risk_level: string | null;
    ai_recommendation: string | null;
    created_at: string;
  }>;
  const decisionMemories = state.decisionMemories as Array<{ id: string; category: string; note: string | null; rule_candidate: boolean; created_at: string }>;
  const workflowRuns = state.workflowRuns as Array<{ id: string; graph_name: string; status: string; current_node: string | null; created_at: string }>;
  const drafts = state.drafts as Array<{ id: string; channel: string; status: string; subject: string | null; body: string; created_at: string }>;
  const messages = state.messages as Array<{
    id: string;
    direction: "OUTBOUND" | "INBOUND";
    channel: string;
    status: string;
    subject: string | null;
    to_address: string | null;
    body: string | null;
    reply_classification: string | null;
    reply_priority: string | null;
    test_mode: boolean;
    created_at: string;
  }>;
  const opportunities = state.opportunities as Array<{ id: string; stage: string; status: string }>;

  const researchFindings = findings.filter((f) => f.type === "company_research");
  const websiteFindings = findings.filter((f) => f.type === "website_diagnosis_lite");
  const growthFindings = findings.filter((f) => f.type === "growth_signal");
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  return (
    <div className="ai-office min-h-screen bg-[var(--office-bg-primary)] text-[var(--office-text-primary)]">
      <header
        className="flex h-16 items-center gap-4 border-b px-4"
        style={{ borderColor: "var(--office-border)", background: "color-mix(in srgb, var(--office-bg-secondary) 85%, transparent)" }}
      >
        <Link href="/office" className="text-xs font-semibold" style={{ color: "var(--office-ai-accent)" }}>
          ← AI Office
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">{lead.company_name as string}</h1>
          <p className="truncate text-[11px]" style={{ color: "var(--office-text-muted)" }}>
            {(lead.industry as string | null) ?? "業種未設定"} ・ {(lead.region as string | null) ?? "地域未設定"}
          </p>
        </div>
        {lead.discovery_stage != null && (
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: "color-mix(in srgb, var(--office-ai-accent) 15%, transparent)", color: "var(--office-ai-accent)" }}
          >
            {DISCOVERY_STAGE_LABEL[lead.discovery_stage as string] ?? (lead.discovery_stage as string)}
          </span>
        )}
        {lead.qualification != null && (
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ color: `var(${QUALIFICATION_VAR[lead.qualification as string] ?? "--office-text-muted"})` }}
          >
            {lead.qualification as string}
          </span>
        )}
      </header>

      {toast && (
        <div
          className="fixed right-4 top-20 z-50 rounded-lg border px-4 py-2 text-sm shadow-lg"
          style={{ borderColor: "var(--office-status-failed)", background: "var(--office-bg-secondary)", color: "var(--office-status-failed)" }}
        >
          {toast}
        </div>
      )}

      <div className="overflow-x-auto border-b px-4" style={{ borderColor: "var(--office-border)" }}>
        <div className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-3 py-2.5 text-[12px] font-semibold"
              style={{
                color: tab === t.key ? "var(--office-ai-accent)" : "var(--office-text-muted)",
                borderBottom: tab === t.key ? "2px solid var(--office-ai-accent)" : "2px solid transparent",
              }}
            >
              {t.label}
              {t.key === "approvals" && pendingApprovals.length > 0 && (
                <span style={{ color: "var(--office-status-failed)", marginLeft: 4 }}>({pendingApprovals.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="space-y-4 p-4">
        {tab === "overview" && (
          <Section title="Overview">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
              <Field label="会社名" value={lead.company_name as string} />
              <Field label="ドメイン" value={(lead.domain as string | null) ?? "—"} />
              <Field label="業種" value={(lead.industry as string | null) ?? "—"} />
              <Field label="地域" value={(lead.region as string | null) ?? "—"} />
              <Field label="ステータス (Phase1)" value={(lead.status as string | null) ?? "—"} />
              <Field label="Discoveryステージ" value={DISCOVERY_STAGE_LABEL[lead.discovery_stage as string] ?? (lead.discovery_stage as string) ?? "—"} />
              <Field label="Source" value={(lead.source_type as string | null) ?? "—"} />
              <Field label="重複判定" value={(lead.duplicate_status as string | null) ?? "—"} />
              <Field label="AIコスト" value={`¥${Number(lead.ai_cost_yen ?? 0).toLocaleString()}`} />
              <Field label="テストモード" value={lead.test_mode ? "はい（synthetic fixture）" : "いいえ"} />
              <Field label="発見日時" value={new Date(lead.discovered_at as string).toLocaleString("ja-JP")} />
              <Field label="最終検証日時" value={lead.last_verified_at ? new Date(lead.last_verified_at as string).toLocaleString("ja-JP") : "—"} />
            </dl>
          </Section>
        )}

        {tab === "research" && (
          <Section title="Research">
            {researchFindings.length === 0 ? (
              <EmptyState message="企業調査の結果はまだありません。" />
            ) : (
              <ul className="space-y-2 text-[12px]">
                {researchFindings.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === "website" && (
          <Section title="Website Analysis">
            {websiteFindings.length === 0 ? (
              <EmptyState message="Webサイト調査の結果はまだありません。" />
            ) : (
              <ul className="space-y-2 text-[12px]">
                {websiteFindings.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </ul>
            )}
            {websiteFindings.some((f) => f.payload?.simulated) && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                ※ 実際のWebサイトへの外部アクセスは行っていません（simulated: true の決定論的診断）。
              </p>
            )}
          </Section>
        )}

        {tab === "score" && (
          <Section title="Score">
            {!latestScore ? (
              <EmptyState message="スコアはまだ算出されていません。" />
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-2xl font-bold">{(latestScore as { total: number }).total}</span>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                    style={{ color: `var(${QUALIFICATION_VAR[(latestScore as { qualification: string }).qualification] ?? "--office-text-muted"})` }}
                  >
                    {(latestScore as { qualification: string }).qualification}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                    score_version: {(latestScore as { score_version: string }).score_version}
                  </span>
                </div>
                <ul className="space-y-1.5 text-[12px]">
                  {((latestScore as { components: Array<{ key: string; label: string; score: number; max: number; reason: string }> }).components ?? []).map(
                    (c) => (
                      <li key={c.key} className="rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{c.label}</span>
                          <span>
                            {c.score} / {c.max}
                          </span>
                        </div>
                        <p style={{ color: "var(--office-text-secondary)" }}>{c.reason}</p>
                      </li>
                    )
                  )}
                </ul>
                {scores.length > 1 && (
                  <p className="mt-3 text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                    履歴: {scores.length}件のスコアリングが記録されています。
                  </p>
                )}
              </>
            )}
          </Section>
        )}

        {tab === "strategy" && (
          <Section title="Sales Strategy">
            {!latestHypothesis ? (
              <EmptyState message="営業仮説はまだ作成されていません。" />
            ) : (
              <HypothesisView hyp={latestHypothesis as Record<string, unknown>} />
            )}
            {drafts.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
                  営業文Draft（未送信）
                </h3>
                <ul className="space-y-2 text-[12px]">
                  {drafts.map((d) => (
                    <li key={d.id} className="rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{d.channel} / {d.subject ?? "件名なし"}</span>
                        <span style={{ color: d.status === "DRAFT_READY" ? "var(--office-status-completed)" : "var(--office-text-secondary)" }}>
                          {d.status}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-line" style={{ color: "var(--office-text-secondary)" }}>
                        {d.body}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                  ※ このDraftは自動送信されません。送信するにはCEO承認後に人手で行う必要があります（External Send Gate）。
                </p>
              </div>
            )}
          </Section>
        )}

        {tab === "outreach" && (
          <Section title="Outreach">
            {opportunities.length > 0 && (
              <p className="mb-3 text-[11px]" style={{ color: "var(--office-ai-accent)" }}>
                商談化済み:{" "}
                <a href={`/office/opportunities/${opportunities[0].id}`} target="_blank" rel="noreferrer" className="underline">
                  Opportunity詳細を見る
                </a>{" "}
                (stage: {opportunities[0].stage})
              </p>
            )}

            {lead.discovery_stage === "READY_FOR_OUTREACH" && messages.length === 0 && (
              <button
                disabled={preparingOutreach}
                onClick={prepareOutreach}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--office-ai-accent)" }}
              >
                営業準備を開始（Sales Outreach Workflow）
              </button>
            )}

            {messages.length === 0 ? (
              <EmptyState message="まだ営業メールのやり取りはありません。" />
            ) : (
              <ul className="space-y-3 text-[12px]">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: "var(--office-border)",
                      background: m.direction === "INBOUND" ? "color-mix(in srgb, var(--office-ai-accent) 8%, transparent)" : "var(--office-bg-primary)",
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "var(--office-text-muted)" }}>
                        {m.direction === "INBOUND" ? "受信" : "送信"} / {m.channel}
                      </span>
                      <span style={{ color: "var(--office-text-secondary)" }}>{MESSAGE_STATUS_LABEL[m.status] ?? m.status}</span>
                      {m.test_mode && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "var(--office-status-warning)" }}>
                          TEST
                        </span>
                      )}
                      {m.reply_classification && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "var(--office-ai-accent)" }}>
                          {m.reply_classification} ({m.reply_priority})
                        </span>
                      )}
                      <span className="ml-auto" style={{ color: "var(--office-text-muted)" }}>
                        {new Date(m.created_at).toLocaleString("ja-JP")}
                      </span>
                    </div>
                    {m.subject && <p className="mt-1 font-semibold">{m.subject}</p>}
                    {m.to_address && (
                      <p style={{ color: "var(--office-text-muted)" }}>宛先: {m.to_address}</p>
                    )}
                    {m.body && <p className="mt-1 whitespace-pre-line" style={{ color: "var(--office-text-secondary)" }}>{m.body}</p>}

                    {m.direction === "OUTBOUND" && m.status === "READY_TO_SEND" && (
                      <button
                        disabled={busyId === m.id}
                        onClick={() => sendMessage(m.id)}
                        className="mt-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        style={{ background: "var(--office-status-failed)" }}
                      >
                        Send Now（実際に送信します）
                      </button>
                    )}

                    {m.direction === "OUTBOUND" && m.status === "SENT" && m.test_mode && (
                      <div className="mt-2 space-y-1.5 rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                        <p style={{ color: "var(--office-text-muted)" }}>テスト返信をシミュレート（Test Modeのみ）:</p>
                        <textarea
                          value={replyDraftText[m.id] ?? ""}
                          onChange={(e) => setReplyDraftText((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          rows={2}
                          className="w-full rounded-md border p-1.5 text-[11px]"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}
                          placeholder="例: ご連絡ありがとうございます。一度お話を伺いたいです。商談の日程を相談できますか？"
                        />
                        <button
                          disabled={busyId === m.id || !(replyDraftText[m.id] ?? "").trim()}
                          onClick={() => simulateReply(m.id)}
                          className="rounded-md px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--office-ai-accent)" }}
                        >
                          テスト返信を送る
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === "evidence" && (
          <Section title="Evidence">
            {findings.length === 0 ? (
              <EmptyState message="Evidence（根拠データ）はまだありません。" />
            ) : (
              <ul className="space-y-2 text-[12px]">
                {[...researchFindings, ...websiteFindings, ...growthFindings].map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === "activity" && (
          <Section title="Activity">
            {events.length === 0 ? (
              <EmptyState message="イベントはまだありません。" />
            ) : (
              <ul className="space-y-1.5 text-[12px]">
                {events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--office-border)" }}>
                    <span>{e.message ?? e.event_type}</span>
                    <span style={{ color: "var(--office-text-muted)" }}>{new Date(e.created_at).toLocaleString("ja-JP")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === "approvals" && (
          <Section title={`Approvals (${pendingApprovals.length} pending)`}>
            {approvals.length === 0 ? (
              <EmptyState message="承認はまだありません。" />
            ) : (
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id} className="rounded-md border p-3 text-[12px]" style={{ borderColor: "var(--office-border)" }}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{a.title}</span>
                      <span
                        style={{
                          color:
                            a.status === "approved"
                              ? "var(--office-status-completed)"
                              : a.status === "pending"
                                ? "var(--office-status-waiting-human)"
                                : "var(--office-status-failed)",
                        }}
                      >
                        {a.status}
                      </span>
                    </div>
                    {a.description && (
                      <p className="mt-1 whitespace-pre-line" style={{ color: "var(--office-text-secondary)" }}>
                        {a.description}
                      </p>
                    )}
                    {a.ai_recommendation && (
                      <p className="mt-1" style={{ color: "var(--office-text-secondary)" }}>
                        AI推奨: {a.ai_recommendation}
                      </p>
                    )}
                    {a.status === "pending" && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          disabled={busyId === a.id}
                          onClick={() => decide(a.id, "approve")}
                          className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--office-status-completed)" }}
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyId === a.id}
                          onClick={() => decide(a.id, "hold")}
                          className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                          style={{ borderColor: "var(--office-border)", color: "var(--office-status-warning)" }}
                        >
                          Hold
                        </button>
                        <button
                          disabled={busyId === a.id}
                          onClick={() => setReasonFor(reasonFor?.id === a.id ? null : { id: a.id, action: "reject" })}
                          className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                          style={{ borderColor: "var(--office-border)" }}
                        >
                          Reject/Revise
                        </button>
                        <button
                          disabled={busyId === a.id}
                          onClick={() => setReasonFor(reasonFor?.id === a.id ? null : { id: a.id, action: "do_not_contact" })}
                          className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                          style={{ borderColor: "var(--office-border)", color: "var(--office-status-failed)" }}
                        >
                          Do Not Contact
                        </button>
                      </div>
                    )}
                    {reasonFor && reasonFor.id === a.id && (
                      <div className="mt-2 space-y-1.5">
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="理由（必須）"
                          rows={2}
                          className="w-full rounded border p-1.5 text-[11px]"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                        <div className="flex gap-1.5">
                          {reasonFor.action === "do_not_contact" ? (
                            <button
                              disabled={!reason.trim()}
                              onClick={() => decide(a.id, "do_not_contact", reason)}
                              className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                              style={{ background: "var(--office-status-failed)" }}
                            >
                              Do Not Contact
                            </button>
                          ) : (
                            <>
                              <button
                                disabled={!reason.trim()}
                                onClick={() => decide(a.id, "revise", reason)}
                                className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                style={{ background: "var(--office-status-waiting-human)" }}
                              >
                                Revise
                              </button>
                              <button
                                disabled={!reason.trim()}
                                onClick={() => decide(a.id, "reject", reason)}
                                className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                style={{ background: "var(--office-status-failed)" }}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === "history" && (
          <Section title="History">
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
                  Workflow Runs
                </h3>
                {workflowRuns.length === 0 ? (
                  <EmptyState message="実行履歴はありません。" />
                ) : (
                  <ul className="space-y-1 text-[12px]">
                    {workflowRuns.map((w) => (
                      <li key={w.id} className="flex items-center justify-between">
                        <span>
                          {w.graph_name} {w.current_node ? `・ ${w.current_node}` : ""}
                        </span>
                        <span style={{ color: "var(--office-text-muted)" }}>{w.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
                  Decision Memory
                </h3>
                {decisionMemories.length === 0 ? (
                  <EmptyState message="Decision Memoryはまだありません。" />
                ) : (
                  <ul className="space-y-1.5 text-[12px]">
                    {decisionMemories.map((d) => (
                      <li key={d.id} className="rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{d.category}</span>
                          {d.rule_candidate && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "var(--office-ai-accent)" }}>
                              ルール候補
                            </span>
                          )}
                        </div>
                        {d.note && <p style={{ color: "var(--office-text-secondary)" }}>{d.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>
        )}
      </main>
    </div>
  );
}

function HypothesisView({ hyp }: { hyp: Record<string, unknown> }) {
  const services = (hyp.recommended_services as Array<{ service: string; reason: string }>) ?? [];
  const unknowns = (hyp.unknowns as string[]) ?? [];
  return (
    <div className="space-y-3 text-[12px]">
      <Field label="観測された課題" value={(hyp.observed_problem as string) ?? "—"} block />
      <Field label="ビジネスインパクト" value={(hyp.business_impact as string) ?? "—"} block />
      <Field label="なぜ今か" value={(hyp.why_now as string) ?? "—"} block />
      <Field label="期待される成果" value={(hyp.expected_outcome as string) ?? "—"} block />
      <Field label="確信度" value={(hyp.confidence as string) ?? "—"} />
      <Field label="Criticステータス" value={(hyp.critic_status as string) ?? "—"} />
      <Field label="修正回数" value={String(hyp.revision_count ?? 0)} />
      <div>
        <dt className="mb-1" style={{ color: "var(--office-text-muted)" }}>
          推奨サービス（最大3件・根拠付き）
        </dt>
        {services.length === 0 ? (
          <p style={{ color: "var(--office-text-muted)" }}>—</p>
        ) : (
          <ul className="space-y-1">
            {services.map((s, i) => (
              <li key={i} className="rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                <span className="font-semibold">{s.service}</span>
                <p style={{ color: "var(--office-text-secondary)" }}>{s.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="想定初期費用(estimated)"
          value={hyp.estimated_initial_value != null ? `¥${Number(hyp.estimated_initial_value).toLocaleString()}` : "—"}
        />
        <Field
          label="想定月額(estimated)"
          value={hyp.estimated_monthly_value != null ? `¥${Number(hyp.estimated_monthly_value).toLocaleString()}` : "—"}
        />
      </div>
      <p className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
        {hyp.price_recommendation
          ? "価格は参考情報であり、正式な見積りではありません。"
          : "価格テーブルは未整備のため、AIによる価格提案は行っていません。"}
      </p>
      {unknowns.length > 0 && (
        <div>
          <dt className="mb-1" style={{ color: "var(--office-text-muted)" }}>
            Unknowns（未確認事項）
          </dt>
          <ul className="list-inside list-disc" style={{ color: "var(--office-text-secondary)" }}>
            {unknowns.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding }: { finding: { id: string; type: string; payload: Record<string, unknown>; created_at: string } }) {
  return (
    <li className="rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{finding.type}</span>
        <span style={{ color: "var(--office-text-muted)" }}>{new Date(finding.created_at).toLocaleString("ja-JP")}</span>
      </div>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap" style={{ color: "var(--office-text-secondary)" }}>
        {JSON.stringify(finding.payload, null, 2)}
      </pre>
    </li>
  );
}

function Field({ label, value, block }: { label: string; value: string; block?: boolean }) {
  return (
    <div className={block ? "" : "flex gap-1"}>
      <dt style={{ color: "var(--office-text-muted)" }}>{label}:</dt>
      <dd className={block ? "mt-0.5 whitespace-pre-line" : ""} style={{ color: "var(--office-text-secondary)" }}>
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
      <h2 className="mb-3 text-sm font-bold">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-[12px]" style={{ color: "var(--office-text-muted)" }}>
      {message}
    </p>
  );
}
