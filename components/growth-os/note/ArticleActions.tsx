"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { retryArticlePipelineAction, approveArticleAction, publishArticleAction } from "@/lib/growth-os/actions";
import type { NoteArticle } from "@/lib/growth-os/types";

export function ArticleActions({ article, hasPendingJob }: { article: NoteArticle; hasPendingJob: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`# ${article.title}\n\n${article.body_markdown}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードAPIが使えない環境では手動選択してもらう
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {article.body_markdown && (
        <Button size="md" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50" onClick={handleCopy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          Markdownをコピー
        </Button>
      )}

      {!hasPendingJob && article.current_stage !== "DONE" && (
        <Button size="md" disabled={isPending} onClick={() => startTransition(() => retryArticlePipelineAction(article.id))}>
          AI処理を実行
        </Button>
      )}
      {hasPendingJob && (
        <span className="text-sm text-gray-400">AI処理中です…(数分お待ちください)</span>
      )}

      {article.status === "WAITING_APPROVAL" && (
        <Button size="md" disabled={isPending} onClick={() => startTransition(() => approveArticleAction(article.id))}>
          承認する
        </Button>
      )}

      {article.status === "APPROVED" && (
        <form action={publishArticleAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={article.id} />
          <Input name="note_url" placeholder="公開後のnote URL(任意)" className="w-64" />
          <Button size="md" type="submit">
            公開済みにする
          </Button>
        </form>
      )}
    </div>
  );
}
