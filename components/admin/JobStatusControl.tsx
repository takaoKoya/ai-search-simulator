"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Status = "DRAFT" | "PUBLISHED" | "CLOSED";

const NEXT: Record<Status, { status: Status; label: string }> = {
  DRAFT: { status: "PUBLISHED", label: "公開する（LINE応募を受付）" },
  PUBLISHED: { status: "CLOSED", label: "募集を終了する" },
  CLOSED: { status: "PUBLISHED", label: "再公開する" },
};

export function JobStatusControl({ id, status }: { id: string; status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT[status];

  async function change() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next.status }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("ステータスの更新に失敗しました");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={change} disabled={busy}>
        {next.label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
