"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  approveIdeaForThreadsAction,
  approveIdeaForNoteFreeAction,
  approveIdeaForNotePaidAction,
  holdIdeaAction,
  rejectIdeaAction,
} from "@/lib/growth-os/actions";

export function IdeaApprovalActions({ ideaId }: { ideaId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="md" disabled={isPending} onClick={() => startTransition(() => approveIdeaForThreadsAction(ideaId))}>
        Threadsを作る
      </Button>
      <Button
        size="md"
        className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
        disabled={isPending}
        onClick={() => startTransition(() => approveIdeaForNoteFreeAction(ideaId))}
      >
        無料noteを作る
      </Button>
      <Button
        size="md"
        className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
        disabled={isPending}
        onClick={() => startTransition(() => approveIdeaForNotePaidAction(ideaId))}
      >
        有料note候補
      </Button>
      <Button
        size="md"
        className="bg-white text-gray-500 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
        disabled={isPending}
        onClick={() => startTransition(() => holdIdeaAction(ideaId))}
      >
        保留
      </Button>
      <Button
        size="md"
        className="bg-white text-rose-600 ring-1 ring-inset ring-rose-100 hover:bg-rose-50"
        disabled={isPending}
        onClick={() => startTransition(() => rejectIdeaAction(ideaId))}
      >
        却下
      </Button>
    </div>
  );
}
