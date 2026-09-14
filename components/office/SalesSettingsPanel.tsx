"use client";

import { useEffect, useState } from "react";

interface IcpProfile {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  target_industries: string[];
  target_regions: string[];
  employee_size_min: number | null;
  employee_size_max: number | null;
  business_model: string | null;
  requires_website: boolean | null;
  target_services: string[];
  score_weights: Record<string, number>;
  qualification_thresholds: Record<string, number>;
}

interface DncEntry {
  id: string;
  company_name: string | null;
  domain: string | null;
  reason: string;
  created_at: string;
  expires_at: string | null;
}

function toCsv(list: string[]): string {
  return list.join(", ");
}
function fromCsv(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * ICP / Do Not Contact settings (spec §11, §14). Score weights and
 * qualification thresholds are edited as raw JSON here rather than a
 * bespoke slider UI — the underlying `computeLeadScore` engine
 * (lib/sales/scoring.ts) already validates/normalizes them at read time.
 */
export default function SalesSettingsPanel({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<IcpProfile[] | null>(null);
  const [dnc, setDnc] = useState<DncEntry[] | null>(null);
  const [editing, setEditing] = useState<Record<string, Partial<IcpProfile>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dncCompany, setDncCompany] = useState("");
  const [dncReason, setDncReason] = useState("");
  const [dncSubmitting, setDncSubmitting] = useState(false);

  async function loadProfiles() {
    const res = await fetch("/api/icp-profiles");
    if (res.ok) setProfiles((await res.json()).icpProfiles ?? []);
  }
  async function loadDnc() {
    const res = await fetch("/api/do-not-contact");
    if (res.ok) setDnc((await res.json()).entries ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/icp-profiles").then(async (res) => {
      if (res.ok && !cancelled) setProfiles((await res.json()).icpProfiles ?? []);
    });
    fetch("/api/do-not-contact").then(async (res) => {
      if (res.ok && !cancelled) setDnc((await res.json()).entries ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function fieldValue<K extends keyof IcpProfile>(p: IcpProfile, key: K): IcpProfile[K] {
    return (editing[p.id]?.[key] as IcpProfile[K]) ?? p[key];
  }
  function setField<K extends keyof IcpProfile>(id: string, key: K, value: IcpProfile[K]) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  async function save(p: IcpProfile) {
    const patch = editing[p.id];
    if (!patch) return;
    setSavingId(p.id);
    try {
      const res = await fetch(`/api/icp-profiles/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(body.error ?? "保存に失敗しました");
        return;
      }
      setEditing((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      await loadProfiles();
    } finally {
      setSavingId(null);
    }
  }

  async function addDnc() {
    if (!dncCompany.trim() || !dncReason.trim()) return;
    setDncSubmitting(true);
    try {
      const res = await fetch("/api/do-not-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: dncCompany.trim(), reason: dncReason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(body.error ?? "登録に失敗しました");
        return;
      }
      setDncCompany("");
      setDncReason("");
      await loadDnc();
    } finally {
      setDncSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-10 flex h-full w-full max-w-[560px] flex-col overflow-y-auto border-l p-5 shadow-2xl"
        style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)", color: "var(--office-text-primary)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">ICP / Do Not Contact 設定</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm hover:bg-white/10" style={{ color: "var(--office-text-secondary)" }}>
            閉じる
          </button>
        </div>

        {toast && (
          <p className="mt-2 text-[12px]" style={{ color: "var(--office-status-failed)" }}>
            {toast}
          </p>
        )}

        <section className="mt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
            ICP Profiles（案件化基準）
          </h3>
          {profiles === null ? (
            <p className="text-[12px]" style={{ color: "var(--office-text-muted)" }}>
              読み込み中...
            </p>
          ) : profiles.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--office-text-muted)" }}>
              ICP Profileがまだありません。
            </p>
          ) : (
            <ul className="space-y-3">
              {profiles.map((p) => {
                const dirty = Boolean(editing[p.id]);
                return (
                  <li key={p.id} className="rounded-lg border p-3" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
                    <div className="flex items-center gap-2">
                      <input
                        value={fieldValue(p, "name")}
                        onChange={(e) => setField(p.id, "name", e.target.value)}
                        className="flex-1 rounded-md border p-1.5 text-[12px] font-semibold"
                        style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                      />
                      {p.is_default && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "var(--office-ai-accent)" }}>
                          Default
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                      <label className="col-span-2">
                        <span style={{ color: "var(--office-text-muted)" }}>対象業種（カンマ区切り）</span>
                        <input
                          value={toCsv(fieldValue(p, "target_industries") ?? [])}
                          onChange={(e) => setField(p.id, "target_industries", fromCsv(e.target.value))}
                          className="mt-0.5 w-full rounded-md border p-1.5"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                      </label>
                      <label className="col-span-2">
                        <span style={{ color: "var(--office-text-muted)" }}>対象地域（カンマ区切り）</span>
                        <input
                          value={toCsv(fieldValue(p, "target_regions") ?? [])}
                          onChange={(e) => setField(p.id, "target_regions", fromCsv(e.target.value))}
                          className="mt-0.5 w-full rounded-md border p-1.5"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                      </label>
                      <label>
                        <span style={{ color: "var(--office-text-muted)" }}>従業員数 下限</span>
                        <input
                          type="number"
                          value={fieldValue(p, "employee_size_min") ?? ""}
                          onChange={(e) => setField(p.id, "employee_size_min", e.target.value === "" ? null : Number(e.target.value))}
                          className="mt-0.5 w-full rounded-md border p-1.5"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                      </label>
                      <label>
                        <span style={{ color: "var(--office-text-muted)" }}>従業員数 上限</span>
                        <input
                          type="number"
                          value={fieldValue(p, "employee_size_max") ?? ""}
                          onChange={(e) => setField(p.id, "employee_size_max", e.target.value === "" ? null : Number(e.target.value))}
                          className="mt-0.5 w-full rounded-md border p-1.5"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                      </label>
                      <label className="col-span-2">
                        <span style={{ color: "var(--office-text-muted)" }}>推奨サービス（カンマ区切り）</span>
                        <input
                          value={toCsv(fieldValue(p, "target_services") ?? [])}
                          onChange={(e) => setField(p.id, "target_services", fromCsv(e.target.value))}
                          className="mt-0.5 w-full rounded-md border p-1.5"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                      </label>
                      <label className="col-span-2">
                        <span style={{ color: "var(--office-text-muted)" }}>Score Weights（合計100・JSON）</span>
                        <textarea
                          rows={2}
                          value={JSON.stringify(fieldValue(p, "score_weights") ?? {})}
                          onChange={(e) => {
                            try {
                              setField(p.id, "score_weights", JSON.parse(e.target.value));
                            } catch {
                              /* wait for valid JSON before updating */
                            }
                          }}
                          className="mt-0.5 w-full rounded-md border p-1.5 font-mono"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                      </label>
                      <label className="col-span-2">
                        <span style={{ color: "var(--office-text-muted)" }}>Qualification Thresholds（JSON）</span>
                        <textarea
                          rows={2}
                          value={JSON.stringify(fieldValue(p, "qualification_thresholds") ?? {})}
                          onChange={(e) => {
                            try {
                              setField(p.id, "qualification_thresholds", JSON.parse(e.target.value));
                            } catch {
                              /* wait for valid JSON before updating */
                            }
                          }}
                          className="mt-0.5 w-full rounded-md border p-1.5 font-mono"
                          style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
                        />
                      </label>
                    </div>

                    <button
                      disabled={!dirty || savingId === p.id}
                      onClick={() => save(p)}
                      className="mt-2 rounded-md px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--office-ai-accent)" }}
                    >
                      保存
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--office-text-muted)" }}>
            Do Not Contact
          </h3>
          <div className="flex gap-2">
            <input
              value={dncCompany}
              onChange={(e) => setDncCompany(e.target.value)}
              placeholder="会社名"
              className="flex-1 rounded-md border p-1.5 text-[12px]"
              style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
            />
            <input
              value={dncReason}
              onChange={(e) => setDncReason(e.target.value)}
              placeholder="理由（必須）"
              className="flex-1 rounded-md border p-1.5 text-[12px]"
              style={{ borderColor: "var(--office-border)", background: "var(--office-bg-primary)" }}
            />
            <button
              disabled={dncSubmitting || !dncCompany.trim() || !dncReason.trim()}
              onClick={addDnc}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--office-status-failed)" }}
            >
              追加
            </button>
          </div>
          <ul className="mt-3 space-y-1.5">
            {(dnc ?? []).map((d) => (
              <li key={d.id} className="rounded-md border p-2 text-[11px]" style={{ borderColor: "var(--office-border)" }}>
                <span className="font-semibold">{d.company_name ?? d.domain}</span> — {d.reason}
              </li>
            ))}
            {dnc !== null && dnc.length === 0 && (
              <li className="text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                Do Not Contactリストは空です。
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
