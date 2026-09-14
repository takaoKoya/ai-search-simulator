"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { ToneMeter } from "@/components/growth-os/threads/ToneMeter";
import { THREADS_PATTERN_LABELS, type ThreadsPost } from "@/lib/growth-os/types";
import {
  approveThreadsPostAction,
  rejectThreadsPostAction,
  markThreadsPostPublishedAction,
} from "@/lib/growth-os/actions";

export function ThreadsPostCard({ post }: { post: ThreadsPost }) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(post.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードAPIが使えない環境ではコピーボタンを無視して手動選択してもらう
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{THREADS_PATTERN_LABELS[post.pattern_type]}</CardTitle>
        <StatusBadge status={post.status} />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm whitespace-pre-wrap text-neutral-800">{post.body}</p>

        {post.tone_scores && <ToneMeter scores={post.tone_scores} />}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="md" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            本文をコピー
          </Button>

          {post.status === "WAITING_APPROVAL" && (
            <>
              <Button size="md" disabled={isPending} onClick={() => startTransition(() => approveThreadsPostAction(post.id))}>
                承認
              </Button>
              <Button
                size="md"
                className="bg-white text-rose-600 ring-1 ring-inset ring-rose-100 hover:bg-rose-50"
                disabled={isPending}
                onClick={() => startTransition(() => rejectThreadsPostAction(post.id))}
              >
                却下
              </Button>
            </>
          )}

          {post.status === "APPROVED" && (
            <Button size="md" disabled={isPending} onClick={() => startTransition(() => markThreadsPostPublishedAction(post.id))}>
              Threadsに投稿済みにする
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
