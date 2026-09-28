"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GrowthOsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6">
      <p className="text-sm font-semibold text-rose-700">エラーが発生しました</p>
      <p className="text-sm text-rose-700">{error.message}</p>
      <Button size="md" onClick={reset}>
        再試行
      </Button>
    </div>
  );
}
