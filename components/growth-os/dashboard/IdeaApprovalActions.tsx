"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { approveIdeaAction, holdIdeaAction, rejectIdeaAction } from "@/lib/growth-os/actions";

export function IdeaApprovalActions({ ideaId }: { ideaId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="md" disabled={isPending} onClick={() => startTransition(() => approveIdeaAction(ideaId))}>
        APPROVE(採用)
      </Button>
      <Button
        size="md"
        className="bg-white text-gray-500 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
        disabled={isPending}
        onClick={() => startTransition(() => holdIdeaAction(ideaId))}
      >
        HOLD(保留)
      </Button>
      <Button
        size="md"
        className="bg-white text-rose-600 ring-1 ring-inset ring-rose-100 hover:bg-rose-50"
        disabled={isPending}
        onClick={() => startTransition(() => rejectIdeaAction(ideaId))}
      >
        REJECT(却下)
      </Button>
    </div>
  );
}
