"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { GeneratedJob } from "@/lib/jobs/schema";

const TARGET_LABELS: Record<GeneratedJob["targetType"], string> = {
  ALBAIT: "アルバイト層",
  SPECIALIST: "専門職層",
  GENERAL: "一般職層",
};

const SNS_LABELS = { x: "X (Twitter)", instagram: "Instagram", line: "LINE" } as const;

export function JobGenerator() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSavedId(null);
    try {
      const res = await fetch("/api/jobs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成に失敗しました");
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "生成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput: text, job: result }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗しました");
      setSavedId(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">求人原稿 AI生成</h1>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="job-text" className="text-sm font-medium">
          求人条件（職種・勤務地・給与・条件などをざっくりと）
        </label>
        <textarea
          id="job-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder="例：渋谷のカフェスタッフ、時給1200円、週2日〜、未経験OK、学生歓迎、シフト自由"
          className="rounded-xl border border-neutral-300 bg-white p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <Button type="submit" disabled={loading || text.trim().length < 10} className="self-start">
          {loading ? "生成中…" : "AIで生成する"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>

      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {savedId ? (
              <Link href={`/admin/jobs/${savedId}`} className="text-sm font-medium underline">
                保存しました。求人詳細を開く →
              </Link>
            ) : (
              <Button onClick={onSave} disabled={saving}>
                {saving ? "保存中…" : "この内容で保存する"}
              </Button>
            )}
          </div>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-neutral-500">判定されたターゲット層</h2>
            <p className="mt-1 text-lg font-bold">{TARGET_LABELS[result.targetType]}</p>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-neutral-500">SNS投稿文</h2>
            {(Object.keys(SNS_LABELS) as (keyof typeof SNS_LABELS)[]).map((k) => (
              <div key={k} className="mt-3">
                <h3 className="text-xs font-semibold">{SNS_LABELS[k]}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{result.snsPostText[k]}</p>
              </div>
            ))}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-neutral-500">Indeed求人原稿</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">{result.indeedText}</p>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-neutral-500">LINEスクリーニング質問</h2>
            <ol className="mt-2 flex flex-col gap-3">
              {result.lineQuestions.map((q, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium">
                    Q{i + 1}. {q.question}
                  </p>
                  <ul className="mt-1 list-inside list-disc text-neutral-600 dark:text-neutral-400">
                    {q.options.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
