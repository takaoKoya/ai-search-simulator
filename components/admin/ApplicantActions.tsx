"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Status = "NEW" | "SCREENING" | "PENDING" | "PASSED" | "REJECTED" | "INTERVIEW_SCHEDULED" | "HIRED";

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "PENDING", label: "要確認" },
  { value: "PASSED", label: "通過" },
  { value: "REJECTED", label: "不通過" },
  { value: "INTERVIEW_SCHEDULED", label: "面接予約済" },
  { value: "HIRED", label: "採用" },
];

interface Props {
  id: string;
  status: Status;
  /** application finished (all questions + interview date answered) */
  completed: boolean;
  defaultTemplate: string;
  defaultConfirmedAt: string;
  notifiedAt: string | null;
}

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: { error?: string } }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: "通信に失敗しました" } };
  }
}

export function ApplicantActions({ id, status, completed, defaultTemplate, defaultConfirmedAt, notifiedAt }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "status" | "rescore" | "notify">(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [template, setTemplate] = useState(defaultTemplate);
  const [confirmedAt, setConfirmedAt] = useState(defaultConfirmedAt);

  const options = STATUS_OPTIONS.some((o) => o.value === status)
    ? STATUS_OPTIONS
    : [{ value: status, label: status === "NEW" ? "新規" : "スクリーニング中" }, ...STATUS_OPTIONS];

  async function run(kind: NonNullable<typeof busy>, req: () => ReturnType<typeof call>, okText: string) {
    setBusy(kind);
    setMessage(null);
    const { ok, data } = await req();
    setBusy(null);
    setMessage(ok ? { kind: "ok", text: okText } : { kind: "error", text: data.error ?? "失敗しました" });
    if (ok) router.refresh();
    return ok;
  }

  async function changeStatus(next: Status) {
    const ok = await run("status", () => call(`/api/applicants/${id}`, "PATCH", { status: next }), "ステータスを更新しました");
    // Never push to a candidate silently: moving to 通過 only opens the guidance panel.
    if (ok && next === "PASSED") setPanelOpen(true);
  }

  async function sendNotice() {
    if (!window.confirm("この応募者のLINEに面接案内を送信します。よろしいですか？")) return;
    const ok = await run(
      "notify",
      () => call(`/api/applicants/${id}/notify`, "POST", { template, confirmedAt: confirmedAt || undefined }),
      "面接案内を送信しました",
    );
    if (ok) setPanelOpen(false);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          ステータス
          <select
            value={status}
            disabled={busy !== null}
            onChange={(e) => changeStatus(e.target.value as Status)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={busy !== null || !completed}
          onClick={() => run("rescore", () => call(`/api/applicants/${id}/rescore`, "POST"), "AIスコアを再実行しました")}
          className="h-9 px-3 text-xs"
        >
          {busy === "rescore" ? "実行中…" : "AIスコア再実行"}
        </Button>
        <Button
          type="button"
          disabled={busy !== null || status === "REJECTED"}
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className="h-9 px-3 text-xs"
        >
          面接案内
        </Button>
        {notifiedAt && <span className="text-xs text-neutral-500">案内送信済 {notifiedAt}</span>}
      </div>

      {panelOpen && (
        <div className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            面接確定日時（送信するとステータスは「面接予約済」になります）
            <input
              type="datetime-local"
              value={confirmedAt}
              onChange={(e) => setConfirmedAt(e.target.value)}
              className="h-9 w-fit rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            案内メッセージ（{"{{name}} {{job}} {{datetime}}"} が差し込まれます）
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={9}
              className="rounded-lg border border-neutral-300 bg-white p-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <Button
            type="button"
            onClick={sendNotice}
            disabled={busy !== null || template.trim() === ""}
            className="h-9 self-start px-4 text-xs"
          >
            {busy === "notify" ? "送信中…" : "面接案内を送信"}
          </Button>
        </div>
      )}

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "error" ? "text-red-600" : "text-green-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
