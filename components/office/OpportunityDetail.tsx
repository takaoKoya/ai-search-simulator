"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OpportunityDetailState } from "@/lib/server/opportunityDetail";
import type { TenantRole } from "@/lib/server/tenant";

const POLL_INTERVAL_MS = 6000;

const STAGE_LABEL: Record<string, string> = {
  candidate: "候補",
  QUALIFIED: "Qualified",
  MEETING: "商談",
  NEEDS_ANALYSIS: "課題分析",
  PROPOSAL_PREPARATION: "提案準備中",
  PROPOSAL_SENT: "提案送付済み",
  NEGOTIATION: "交渉中",
  VERBAL_AGREEMENT: "口頭合意",
  WON: "受注",
  LOST: "失注",
  ON_HOLD: "保留",
};

const MEETING_STATUS_LABEL: Record<string, string> = {
  PROPOSED: "候補提示",
  SCHEDULING: "日程調整中",
  SCHEDULED: "確定",
  COMPLETED: "完了",
  CANCELLED: "キャンセル",
  NO_SHOW: "No Show",
};

const REACTION_OPTIONS = ["PRICE_OBJECTION", "SCOPE_CHANGE", "TIMING_CHANGE", "COMPETITOR", "LEGAL_CONCERN", "PROCUREMENT", "APPROVED", "DECLINED"];
const LOST_REASON_OPTIONS = ["competitor", "price_issue", "timing", "no_budget", "no_need", "internal_issue", "unknown", "other"];

export default function OpportunityDetail({
  opportunityId,
  initialState,
  role,
}: {
  opportunityId: string;
  initialState: OpportunityDetailState;
  role: TenantRole;
}) {
  const [state, setState] = useState(initialState);
  const [toast, setToast] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<{ id: string; action: "reject" | "revise" | "do_not_contact" } | null>(null);
  const [reason, setReason] = useState("");
  const [transcriptDraft, setTranscriptDraft] = useState<Record<string, string>>({});
  const [reactionCategory, setReactionCategory] = useState(REACTION_OPTIONS[0]);
  const [reactionNote, setReactionNote] = useState("");
  const [lostReason, setLostReason] = useState(LOST_REASON_OPTIONS[0]);
  const [lostDetail, setLostDetail] = useState("");
  const [clientIntentConfirmed, setClientIntentConfirmed] = useState(false);
  const inFlight = useRef(false);
  const canApprove = role === "owner" || role === "ceo" || role === "admin";

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/detail`);
      if (res.ok) setState(await res.json());
    } finally {
      inFlight.current = false;
    }
  }, [opportunityId]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function call(key: string, path: string, body?: Record<string, unknown>) {
    setBusyKey(key);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(json.error ?? "エラーが発生しました");
        return null;
      }
      await refresh();
      return json;
    } finally {
      setBusyKey(null);
    }
  }

  async function decide(approvalId: string, action: "approve" | "reject" | "revise" | "hold" | "do_not_contact", withReason?: string) {
    if (!canApprove) {
      setToast("この操作にはCEO/管理者権限が必要です");
      return;
    }
    await call(`decide-${approvalId}`, `/api/approvals/${approvalId}/decide`, { action, reason: withReason });
    setReasonFor(null);
    setReason("");
  }

  const opportunity = state.opportunity as Record<string, unknown>;
  const lead = state.lead as Record<string, unknown> | null;
  const meetings = state.meetings as Array<Record<string, unknown>>;
  const proposals = state.proposals as Array<Record<string, unknown>>;
  const estimates = state.estimates as Array<Record<string, unknown>>;
  const negotiationItems = state.negotiationItems as Array<{ id: string; payload: Record<string, unknown>; created_at: string }>;
  const approvals = state.approvals as Array<{
    id: string;
    type: string;
    title: string;
    description: string | null;
    status: string;
    ai_recommendation: string | null;
    subject_id: string;
    created_at: string;
  }>;
  const events = state.events as Array<{ id: string; event_type: string; message: string | null; created_at: string }>;

  const companyName = (lead?.company_name as string | undefined) ?? "対象企業";
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const estimateByProposalId = new Map(estimates.map((e) => [e.proposal_id as string, e]));

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
          <h1 className="truncate text-base font-bold">{companyName}</h1>
          <Link href={`/office/leads/${opportunity.lead_id}`} className="truncate text-[11px] underline" style={{ color: "var(--office-text-muted)" }}>
            Lead詳細を見る
          </Link>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: "color-mix(in srgb, var(--office-ai-accent) 15%, transparent)", color: "var(--office-ai-accent)" }}
        >
          {STAGE_LABEL[opportunity.stage as string] ?? (opportunity.stage as string)}
        </span>
      </header>

      {toast && (
        <div
          className="fixed right-4 top-20 z-50 rounded-lg border px-4 py-2 text-sm shadow-lg"
          style={{ borderColor: "var(--office-status-failed)", background: "var(--office-bg-secondary)", color: "var(--office-status-failed)" }}
        >
          {toast}
        </div>
      )}

      <main className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Section title="Overview">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
              <Field label="想定金額(estimated)" value={fmtYen(opportunity.estimated_value as number | null)} />
              <Field label="確定金額" value={fmtYen(opportunity.confirmed_value as number | null)} />
              <Field label="確度" value={opportunity.probability != null ? `${opportunity.probability}%` : "—"} />
              <Field label="想定クロージング日" value={(opportunity.expected_close_date as string | null) ?? "—"} />
              <Field label="決裁者" value={(opportunity.decision_maker as string | null) ?? "—"} />
              <Field label="予算感" value={(opportunity.budget as string | null) ?? "—"} />
              <Field label="ニーズ" value={(opportunity.need as string | null) ?? "—"} />
              <Field label="スケジュール感" value={(opportunity.timeline as string | null) ?? "—"} />
            </dl>
          </Section>

          <Section title="Meetings">
            <button
              disabled={busyKey === "propose-meeting"}
              onClick={() => call("propose-meeting", `/api/opportunities/${opportunityId}/meetings`)}
              className="mb-3 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--office-ai-accent)" }}
            >
              商談候補日時を提示させる
            </button>
            {meetings.length === 0 ? (
              <EmptyState message="商談はまだありません。" />
            ) : (
              <ul className="space-y-3">
                {meetings.map((m) => {
                  const id = m.id as string;
                  const candidateTimes = (m.candidate_times as Array<{ start: string; end: string }>) ?? [];
                  const minutes = m.minutes as Record<string, unknown> | null;
                  return (
                    <li key={id} className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--office-border)" }}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{m.title as string}</span>
                        <span style={{ color: "var(--office-text-muted)" }}>{MEETING_STATUS_LABEL[m.status as string] ?? (m.status as string)}</span>
                      </div>

                      {m.status === "SCHEDULING" && candidateTimes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {candidateTimes.map((slot, i) => (
                            <button
                              key={i}
                              disabled={busyKey === `select-${id}`}
                              onClick={() => call(`select-${id}`, `/api/meetings/${id}/select-time`, slot)}
                              className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                              style={{ borderColor: "var(--office-border)" }}
                            >
                              {new Date(slot.start).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </button>
                          ))}
                        </div>
                      )}

                      {m.status === "SCHEDULED" && (
                        <p style={{ color: "var(--office-text-secondary)" }}>
                          {new Date(m.scheduled_at as string).toLocaleString("ja-JP")} ({m.duration_minutes as number}分) {m.meeting_url ? `／ ${m.meeting_url}` : ""}
                        </p>
                      )}

                      {(m.agenda as string[] | undefined)?.length ? (
                        <details className="mt-1">
                          <summary style={{ color: "var(--office-text-muted)" }}>アジェンダDraft</summary>
                          <ol className="ml-4 list-decimal" style={{ color: "var(--office-text-secondary)" }}>
                            {(m.agenda as string[]).map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ol>
                        </details>
                      ) : null}

                      {(m.status === "SCHEDULED" || m.status === "COMPLETED") && !minutes && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            disabled={busyKey === `prep-${id}`}
                            onClick={() => call(`prep-${id}`, `/api/meetings/${id}/prep`)}
                            className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                            style={{ borderColor: "var(--office-border)" }}
                          >
                            商談準備資料を作成
                          </button>
                        </div>
                      )}

                      {m.status === "SCHEDULED" && m.transcript_status !== "PROCESSED" && (
                        <div className="mt-2 space-y-1.5 rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                          <textarea
                            value={transcriptDraft[id] ?? (m.transcript as string | null) ?? ""}
                            onChange={(e) => setTranscriptDraft((prev) => ({ ...prev, [id]: e.target.value }))}
                            placeholder="商談の文字起こし（テスト用テキストを貼り付け）"
                            rows={3}
                            className="w-full rounded border p-1.5 text-[11px]"
                            style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                          />
                          <div className="flex gap-1.5">
                            <button
                              disabled={busyKey === `transcript-${id}` || !(transcriptDraft[id] ?? "").trim()}
                              onClick={() => call(`transcript-${id}`, `/api/meetings/${id}/transcript`, { transcript: transcriptDraft[id] })}
                              className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                              style={{ borderColor: "var(--office-border)" }}
                            >
                              Transcriptを保存
                            </button>
                            <button
                              disabled={busyKey === `minutes-${id}` || !m.transcript}
                              onClick={() => call(`minutes-${id}`, `/api/meetings/${id}/minutes`)}
                              className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                              style={{ borderColor: "var(--office-border)" }}
                            >
                              議事録Draftを作成
                            </button>
                          </div>
                        </div>
                      )}

                      {minutes && (
                        <div className="mt-2 rounded-md border p-2 text-[11px]" style={{ borderColor: "var(--office-border)" }}>
                          <p>
                            <b>Summary:</b> {String(minutes.summary ?? "")}
                          </p>
                          <p>
                            <b>Budget:</b> {String(minutes.budget ?? "UNKNOWN")} / <b>Authority:</b> {String(minutes.authority ?? "UNASSIGNED")} / <b>Timing:</b>{" "}
                            {String(minutes.timing ?? "UNSET")}
                          </p>
                          {m.minutes_status === "DRAFT" && (
                            <button
                              disabled={busyKey === `confirm-${id}`}
                              onClick={() => call(`confirm-${id}`, `/api/meetings/${id}/minutes/confirm`)}
                              className="mt-1 rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                              style={{ background: "var(--office-status-completed)" }}
                            >
                              人間が確認し、Opportunityへ反映
                            </button>
                          )}
                          {m.minutes_status === "HUMAN_REVIEWED" && <p style={{ color: "var(--office-status-completed)" }}>✓ 人間が確認済み</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Proposal / Estimate">
            <button
              disabled={busyKey === "create-proposal"}
              onClick={() => call("create-proposal", `/api/opportunities/${opportunityId}/proposals`)}
              className="mb-3 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--office-ai-accent)" }}
            >
              提案書・見積Draftを作成
            </button>
            {proposals.length === 0 ? (
              <EmptyState message="提案書はまだありません。" />
            ) : (
              <ul className="space-y-3">
                {proposals.map((p) => {
                  const id = p.id as string;
                  const estimate = estimateByProposalId.get(id);
                  return (
                    <li key={id} className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--office-border)" }}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{p.title as string} (v{p.version as number})</span>
                        <span style={{ color: "var(--office-text-muted)" }}>{p.status as string}</span>
                      </div>
                      <p className="mt-1" style={{ color: "var(--office-text-secondary)" }}>
                        {p.executive_summary as string}
                      </p>
                      {estimate && (
                        <p className="mt-1" style={{ color: "var(--office-text-secondary)" }}>
                          見積合計: ¥{Number(estimate.total).toLocaleString()}（内、値引き ¥{Number(estimate.discount).toLocaleString()}）
                        </p>
                      )}
                      {p.status === "APPROVED" && (
                        <button
                          disabled={busyKey === `send-proposal-${id}`}
                          onClick={() => call(`send-proposal-${id}`, `/api/proposals/${id}/send`)}
                          className="mt-2 rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--office-status-failed)" }}
                        >
                          Send（提案書を送付）
                        </button>
                      )}
                      {p.status === "SENT" && <p style={{ color: "var(--office-status-completed)" }}>✓ 送付済み（{String(p.sent_at ?? "")}）</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Negotiation">
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <select
                value={reactionCategory}
                onChange={(e) => setReactionCategory(e.target.value)}
                className="rounded border p-1.5 text-[12px]"
                style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
              >
                {REACTION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                value={reactionNote}
                onChange={(e) => setReactionNote(e.target.value)}
                placeholder="メモ（任意）"
                className="flex-1 rounded border p-1.5 text-[12px]"
                style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
              />
              <button
                disabled={busyKey === "log-negotiation"}
                onClick={async () => {
                  await call("log-negotiation", `/api/opportunities/${opportunityId}/negotiation-items`, { reactionCategory, note: reactionNote || undefined });
                  setReactionNote("");
                }}
                className="rounded px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--office-ai-accent)" }}
              >
                記録して分析
              </button>
            </div>
            {negotiationItems.length === 0 ? (
              <EmptyState message="交渉論点はまだありません。" />
            ) : (
              <ul className="space-y-2 text-[12px]">
                {negotiationItems.map((item) => (
                  <li key={item.id} className="rounded-md border p-2" style={{ borderColor: "var(--office-border)" }}>
                    <p className="font-semibold">{String(item.payload.reactionCategory)}</p>
                    <p style={{ color: "var(--office-text-secondary)" }}>{String(item.payload.clientConcern ?? "")}</p>
                    <p style={{ color: "var(--office-text-secondary)" }}>推奨対応: {String(item.payload.recommendedResponse ?? "")}</p>
                    {Number(item.payload.suggestedMaxDiscountRate ?? 0) > 0 && (
                      <p style={{ color: "var(--office-status-warning)" }}>
                        値引き上限目安: {Math.round(Number(item.payload.suggestedMaxDiscountRate) * 100)}%（CEO判断が必要）
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Activity">
            {events.length === 0 ? (
              <EmptyState message="イベントはまだありません。" />
            ) : (
              <ul className="space-y-1 text-[12px]">
                {events.slice(0, 30).map((e) => (
                  <li key={e.id} className="flex items-center justify-between">
                    <span>{e.message ?? e.event_type}</span>
                    <span style={{ color: "var(--office-text-muted)" }}>{new Date(e.created_at).toLocaleString("ja-JP")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title={`Approvals (${pendingApprovals.length})`}>
            {approvals.length === 0 ? (
              <EmptyState message="承認はまだありません。" />
            ) : (
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id} className="rounded-md border p-2 text-[12px]" style={{ borderColor: "var(--office-border)" }}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{a.title}</span>
                      <span style={{ color: a.status === "pending" ? "var(--office-status-waiting-human)" : "var(--office-text-muted)" }}>{a.status}</span>
                    </div>
                    {a.status === "pending" && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button
                          disabled={busyKey === `decide-${a.id}`}
                          onClick={() => decide(a.id, "approve")}
                          className="rounded px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--office-status-completed)" }}
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyKey === `decide-${a.id}`}
                          onClick={() => decide(a.id, "hold")}
                          className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                          style={{ borderColor: "var(--office-border)", color: "var(--office-status-warning)" }}
                        >
                          Hold
                        </button>
                        <button
                          disabled={busyKey === `decide-${a.id}`}
                          onClick={() => setReasonFor(reasonFor?.id === a.id ? null : { id: a.id, action: "reject" })}
                          className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                          style={{ borderColor: "var(--office-border)" }}
                        >
                          Reject/Revise
                        </button>
                      </div>
                    )}
                    {reasonFor && reasonFor.id === a.id && (
                      <div className="mt-1.5 space-y-1">
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="理由（必須）"
                          rows={2}
                          className="w-full rounded border p-1 text-[11px]"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                        <div className="flex gap-1.5">
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
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {opportunity.stage !== "WON" && opportunity.stage !== "LOST" && (
            <Section title="WON / LOST">
              <label className="mb-2 flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={clientIntentConfirmed} onChange={(e) => setClientIntentConfirmed(e.target.checked)} />
                顧客の受諾意思を確認した(Client Intent Confirmed)
              </label>
              <button
                disabled={busyKey === "won-gate"}
                onClick={() => call("won-gate", `/api/opportunities/${opportunityId}/won`, { clientIntentConfirmed })}
                className="mb-3 w-full rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--office-status-completed)" }}
              >
                受注確定を申請(WON Gate)
              </button>

              <div className="space-y-1.5 border-t pt-3" style={{ borderColor: "var(--office-border)" }}>
                <select
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="w-full rounded border p-1.5 text-[12px]"
                  style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                >
                  {LOST_REASON_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <input
                  value={lostDetail}
                  onChange={(e) => setLostDetail(e.target.value)}
                  placeholder="詳細（任意）"
                  className="w-full rounded border p-1.5 text-[12px]"
                  style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                />
                <button
                  disabled={busyKey === "mark-lost"}
                  onClick={() => call("mark-lost", `/api/opportunities/${opportunityId}/lost`, { lostReason, lostDetail })}
                  className="w-full rounded-lg border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                  style={{ borderColor: "var(--office-border)", color: "var(--office-status-failed)" }}
                >
                  失注(LOST)にする
                </button>
              </div>
            </Section>
          )}
        </aside>
      </main>
    </div>
  );
}

function fmtYen(value: number | null | undefined): string {
  return value != null ? `¥${value.toLocaleString()}` : "—";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt style={{ color: "var(--office-text-muted)" }}>{label}:</dt>
      <dd style={{ color: "var(--office-text-secondary)" }}>{value}</dd>
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
