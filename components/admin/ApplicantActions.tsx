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

export interface SavedTemplate {
  id: string;
  name: string;
  body: string;
  /** null = shared by all jobs */
  jobId: string | null;
}

const BUILTIN_ID = "__builtin__";

interface Props {
  id: string;
  jobId: string;
  templates: SavedTemplate[];
  profileIncomplete: boolean;
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

export function ApplicantActions({ id, jobId, templates, profileIncomplete, status, completed, defaultTemplate, defaultConfirmedAt, notifiedAt }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "status" | "rescore" | "notify" | "profile" | "template">(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [template, setTemplate] = useState(defaultTemplate);
  const [confirmedAt, setConfirmedAt] = useState(defaultConfirmedAt);
  const [selectedId, setSelectedId] = useState(BUILTIN_ID);
  const [saveName, setSaveName] = useState("");
  const [saveShared, setSaveShared] = useState(false);
  const selected = templates.find((t) => t.id === selectedId);

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

  function pickTemplate(templateId: string) {
    setSelectedId(templateId);
    const t = templates.find((x) => x.id === templateId);
    setTemplate(t ? t.body : defaultTemplate);
  }

  async function saveNew() {
    const ok = await run(
      "template",
      () => call("/api/templates", "POST", { name: saveName, body: template, jobId: saveShared ? null : jobId }),
      "テンプレートを保存しました",
    );
    if (ok) setSaveName("");
  }

  async function overwrite() {
    if (!selected) return;
    await run("template", () => call(`/api/templates/${selected.id}`, "PATCH", { name: selected.name, body: template }), "テンプレートを上書き保存しました");
  }

  async function remove() {
    if (!selected || !window.confirm(`テンプレート「${selected.name}」を削除します。よろしいですか？`)) return;
    const ok = await run("template", () => call(`/api/templates/${selected.id}`, "DELETE"), "テンプレートを削除しました");
    if (ok) pickTemplate(BUILTIN_ID);
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
        {profileIncomplete && (
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => run("profile", () => call(`/api/applicants/${id}/sync-profile`, "POST"), "LINEプロフィールを更新しました")}
            className="h-9 px-3 text-xs"
          >
            {busy === "profile" ? "取得中…" : "プロフィール再取得"}
          </Button>
        )}
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
            テンプレートを読み込む
            <select
              value={selectedId}
              onChange={(e) => pickTemplate(e.target.value)}
              className="h-9 w-fit max-w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            >
              <option value={BUILTIN_ID}>標準テンプレート</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.jobId === null ? "【共通】" : "【この求人】"}
                  {t.name}
                </option>
              ))}
            </select>
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
          <div className="flex flex-wrap items-end gap-2 border-t border-dashed border-neutral-300 pt-2 dark:border-neutral-700">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              テンプレート名
              <input
                value={saveName}
                maxLength={50}
                onChange={(e) => setSaveName(e.target.value)}
                className="h-9 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
            <label className="flex h-9 items-center gap-1 text-xs text-neutral-500">
              <input type="checkbox" checked={saveShared} onChange={(e) => setSaveShared(e.target.checked)} />
              全求人で共通
            </label>
            <Button type="button" onClick={saveNew} disabled={busy !== null || !saveName.trim() || !template.trim()} className="h-9 px-3 text-xs">
              新規保存
            </Button>
            {selected && (
              <>
                <Button type="button" onClick={overwrite} disabled={busy !== null || !template.trim()} className="h-9 px-3 text-xs">
                  「{selected.name}」を上書き
                </Button>
                <Button type="button" onClick={remove} disabled={busy !== null} className="h-9 px-3 text-xs">
                  削除
                </Button>
              </>
            )}
          </div>
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
