export type EventCategory = "sales" | "ops" | "approval" | "contract" | "delivery";
export type EventSeverity = "info" | "warning" | "error";

export const FILTER_TABS = [
  { key: "all", label: "すべて" },
  { key: "sales", label: "営業" },
  { key: "ops", label: "実務" },
  { key: "approval", label: "承認" },
  { key: "contract", label: "契約" },
  { key: "delivery", label: "納品" },
  { key: "warning", label: "Warning" },
  { key: "error", label: "Error" },
] as const;

export type FilterKey = (typeof FILTER_TABS)[number]["key"];

interface EventTypeMeta {
  label: string;
  category: EventCategory;
  severity: EventSeverity;
  icon: string;
}

const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  "lead.created": { label: "Lead登録", category: "sales", severity: "info", icon: "＋" },
  "lead.researched": { label: "調査完了", category: "sales", severity: "info", icon: "🔍" },
  "lead.scored": { label: "スコア算出", category: "sales", severity: "info", icon: "📊" },
  "lead.search_strategy_created": { label: "検索戦略作成", category: "sales", severity: "info", icon: "🧭" },
  "lead.candidate_discovered": { label: "候補企業を発見", category: "sales", severity: "info", icon: "🏢" },
  "lead.excluded": { label: "Lead除外", category: "sales", severity: "warning", icon: "⛔" },
  "lead.growth_signal_detected": { label: "成長シグナル検出", category: "sales", severity: "info", icon: "📈" },
  "lead.qualified": { label: "案件化判定", category: "sales", severity: "info", icon: "🔥" },
  "lead.archived": { label: "Leadアーカイブ", category: "sales", severity: "info", icon: "🗂" },
  "sales_hypothesis.created": { label: "営業仮説作成", category: "sales", severity: "info", icon: "💡" },
  "sales_draft.created": { label: "営業文Draft作成", category: "sales", severity: "info", icon: "📝" },
  "sales_draft.ready": { label: "営業準備完了", category: "sales", severity: "info", icon: "✅" },
  "decision.rule_candidate_detected": { label: "ルール候補を検出", category: "ops", severity: "info", icon: "🧠" },

  "outreach.channel_selected": { label: "送信チャネル選定", category: "sales", severity: "info", icon: "📡" },
  "sales_message.sent": { label: "営業メール送信", category: "sales", severity: "info", icon: "📤" },
  "lead.reply_received": { label: "返信受信", category: "sales", severity: "info", icon: "📥" },
  "lead.reply_logged": { label: "返信を記録(返信案なし)", category: "sales", severity: "info", icon: "📋" },
  "opportunity.stage_changed": { label: "商談ステージ変更", category: "sales", severity: "info", icon: "🔀" },
  "opportunity.won_gate_passed": { label: "受注前提条件を充足", category: "sales", severity: "info", icon: "✅" },
  "opportunity.won": { label: "受注(WON)", category: "sales", severity: "info", icon: "🏆" },
  "opportunity.lost": { label: "失注(LOST)", category: "sales", severity: "warning", icon: "📉" },
  "meeting.times_proposed": { label: "商談候補日時を提示", category: "sales", severity: "info", icon: "🗓" },
  "meeting.scheduled": { label: "商談日時確定", category: "sales", severity: "info", icon: "📅" },
  "meeting.prep_ready": { label: "商談準備完了", category: "sales", severity: "info", icon: "🧾" },
  "meeting.minutes_drafted": { label: "議事録Draft作成", category: "sales", severity: "info", icon: "📝" },
  "meeting.minutes_reviewed": { label: "議事録レビュー完了", category: "sales", severity: "info", icon: "✔" },
  "proposal.created": { label: "提案書Draft作成", category: "sales", severity: "info", icon: "📄" },
  "proposal.sent": { label: "提案書送付", category: "sales", severity: "info", icon: "📨" },
  "estimate.created": { label: "見積作成", category: "sales", severity: "info", icon: "💰" },
  "negotiation.item_logged": { label: "交渉論点を記録", category: "sales", severity: "info", icon: "🤝" },

  "agent.started": { label: "Agent開始", category: "ops", severity: "info", icon: "▶" },
  "agent.completed": { label: "Agent完了", category: "ops", severity: "info", icon: "✓" },
  "agent.failed": { label: "Agent失敗", category: "ops", severity: "error", icon: "✕" },
  "agent.handoff": { label: "Handoff", category: "ops", severity: "info", icon: "→" },

  "workflow.started": { label: "Workflow開始", category: "ops", severity: "info", icon: "▶" },
  "workflow.waiting_human": { label: "承認待ちで一時停止", category: "approval", severity: "info", icon: "⏸" },
  "workflow.resumed": { label: "Workflow再開", category: "ops", severity: "info", icon: "↻" },
  "workflow.completed": { label: "Workflow完了", category: "ops", severity: "info", icon: "✓" },
  "workflow.failed": { label: "Workflow失敗", category: "ops", severity: "error", icon: "✕" },

  "approval.requested": { label: "承認依頼", category: "approval", severity: "info", icon: "?" },
  "approval.approved": { label: "承認", category: "approval", severity: "info", icon: "✓" },
  "approval.rejected": { label: "却下", category: "approval", severity: "warning", icon: "✕" },
  "approval.revision_requested": { label: "差し戻し", category: "approval", severity: "warning", icon: "↩" },
  "approval.hold": { label: "保留", category: "approval", severity: "warning", icon: "⏸" },
  "approval.do_not_contact": { label: "営業しない", category: "approval", severity: "warning", icon: "🚫" },

  "contract.reviewed": { label: "契約レビュー", category: "contract", severity: "info", icon: "📄" },
  "contract.risk_detected": { label: "契約リスク検出", category: "contract", severity: "warning", icon: "⚠" },

  "project.created": { label: "Project作成", category: "ops", severity: "info", icon: "＋" },
  "team.created": { label: "Team編成", category: "ops", severity: "info", icon: "◇" },

  "task.created": { label: "Task作成", category: "ops", severity: "info", icon: "◇" },
  "task.started": { label: "Task開始", category: "ops", severity: "info", icon: "▶" },
  "task.completed": { label: "Task完了", category: "ops", severity: "info", icon: "✓" },
  "task.blocked": { label: "Taskブロック", category: "ops", severity: "warning", icon: "⛔" },

  "critic.reviewed": { label: "Criticレビュー", category: "ops", severity: "info", icon: "👁" },
  "critic.rejected": { label: "Critic差し戻し", category: "ops", severity: "warning", icon: "⚠" },

  "qa.started": { label: "QA開始", category: "ops", severity: "info", icon: "▶" },
  "qa.passed": { label: "QA通過", category: "ops", severity: "info", icon: "✓" },
  "qa.failed": { label: "QA失敗", category: "ops", severity: "error", icon: "✕" },

  "delivery.approval_requested": { label: "納品承認依頼", category: "delivery", severity: "info", icon: "?" },
  "delivery.approved": { label: "納品承認", category: "delivery", severity: "info", icon: "✓" },
  "delivery.completed": { label: "納品完了", category: "delivery", severity: "info", icon: "★" },

  "report.created": { label: "レポート作成", category: "ops", severity: "info", icon: "📈" },
  "initiative.created": { label: "継続提案作成", category: "ops", severity: "info", icon: "＋" },
};

const FALLBACK: EventTypeMeta = { label: "イベント", category: "ops", severity: "info", icon: "•" };

const APPROVAL_PAYLOAD_TYPE_TO_CATEGORY: Record<string, EventCategory> = {
  sales_outreach: "sales",
  sales_lead: "sales",
  sales_send: "sales",
  sales_reply: "sales",
  proposal_approval: "sales",
  deal_won: "sales",
  contract_approval: "contract",
  delivery: "delivery",
};

export interface EventLike {
  event_type: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Resolves category/severity/icon for an event. Approval lifecycle events
 * (approval.requested/approved/rejected/revision_requested) carry their
 * domain in `payload.type` (sales_outreach/contract_approval/delivery), so
 * their category is derived from that real field rather than the static
 * table — an approval.approved for a contract shows under "契約", not a
 * generic "承認" bucket.
 */
export function getEventMeta(event: EventLike): EventTypeMeta {
  const base = EVENT_TYPE_META[event.event_type] ?? FALLBACK;
  if (event.event_type.startsWith("approval.")) {
    const payloadType = event.payload?.type as string | undefined;
    const category = payloadType ? (APPROVAL_PAYLOAD_TYPE_TO_CATEGORY[payloadType] ?? base.category) : base.category;
    return { ...base, category };
  }
  return base;
}

export function eventLabel(eventType: string): string {
  return EVENT_TYPE_META[eventType]?.label ?? eventType;
}

export function matchesFilter(event: EventLike, filter: FilterKey): boolean {
  if (filter === "all") return true;
  const meta = getEventMeta(event);
  if (filter === "warning") return meta.severity === "warning";
  if (filter === "error") return meta.severity === "error";
  return meta.category === filter;
}
