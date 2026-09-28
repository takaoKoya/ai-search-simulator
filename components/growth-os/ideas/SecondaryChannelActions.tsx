"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createThreadsFromIdeaAction, createNoteFreeFromIdeaAction, createNotePaidFromIdeaAction } from "@/lib/growth-os/actions";

/**
 * APPROVED後の任意アクション。Threads/note本格生成はフェーズ3で扱う想定だが、
 * フェーズ1で実装済みの入口(ジョブ起動)はそのまま活かす。
 */
export function SecondaryChannelActions({ ideaId }: { ideaId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="md"
        className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
        disabled={isPending}
        onClick={() => startTransition(() => createThreadsFromIdeaAction(ideaId))}
      >
        Threadsを作る(試験機能)
      </Button>
      <Button
        size="md"
        className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
        disabled={isPending}
        onClick={() => startTransition(() => createNoteFreeFromIdeaAction(ideaId))}
      >
        無料noteを作る(試験機能)
      </Button>
      <Button
        size="md"
        className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
        disabled={isPending}
        onClick={() => startTransition(() => createNotePaidFromIdeaAction(ideaId))}
      >
        有料note候補にする(試験機能)
      </Button>
    </div>
  );
}
