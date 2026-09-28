"use client";

import { useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createContentFromIdeaAction } from "@/lib/growth-os/actions";

/**
 * フェーズ3の統一エントリーポイント(セクション32)。
 * このボタン1つでContent Strategy→Threads 5案→無料noteのOutlineまで自動連鎖する。
 */
export function CreateContentButton({ ideaId }: { ideaId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button size="md" disabled={isPending} onClick={() => startTransition(() => createContentFromIdeaAction(ideaId))}>
      <Sparkles className="h-4 w-4" />
      コンテンツを作成
    </Button>
  );
}
