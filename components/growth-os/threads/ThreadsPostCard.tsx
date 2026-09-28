"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { ThreadsScorePanel } from "@/components/growth-os/threads/ThreadsScorePanel";
import { THREADS_PATTERN_LABELS, type ThreadsPost } from "@/lib/growth-os/types";
import {
  approveThreadsPostAction,
  rejectThreadsPostAction,
  markThreadsPostPublishedAction,
  regenerateThreadsPostAction,
  manualEditThreadsPostAction,
} from "@/lib/growth-os/actions";

export function ThreadsPostCard({ post }: { post: ThreadsPost }) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);

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
        <CardTitle className="flex items-center gap-2">
          {THREADS_PATTERN_LABELS[post.pattern_type]}
          {post.manual_edited && <Badge variant="neutral">手動編集済み</Badge>}
        </CardTitle>
        <StatusBadge status={post.status} />
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} className="text-sm" />
        ) : (
          <p className="text-sm whitespace-pre-wrap text-neutral-800">{post.body}</p>
        )}

        <ThreadsScorePanel post={post} />

        <div className="flex flex-wrap gap-2 pt-2">
          {editing ? (
            <>
              <Button
                size="md"
                disabled={isPending}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("id", post.id);
                  formData.set("body", draft);
                  startTransition(async () => {
                    await manualEditThreadsPostAction(formData);
                    setEditing(false);
                  });
                }}
              >
                保存
              </Button>
              <Button
                size="md"
                className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                onClick={() => {
                  setDraft(post.body);
                  setEditing(false);
                }}
              >
                キャンセル
              </Button>
            </>
          ) : (
            <>
              <Button size="md" className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                本文をコピー
              </Button>
              <Button
                size="md"
                className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-4 w-4" />
                編集
              </Button>
              {!post.manual_edited && post.rewrite_count < 2 && (
                <Button
                  size="md"
                  className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                  disabled={isPending}
                  onClick={() => startTransition(() => regenerateThreadsPostAction(post.id))}
                >
                  AIで再生成
                </Button>
              )}
            </>
          )}

          {post.status === "WAITING_APPROVAL" && !editing && (
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

          {post.status === "APPROVED" && !editing && (
            <Button size="md" disabled={isPending} onClick={() => startTransition(() => markThreadsPostPublishedAction(post.id))}>
              Threadsに投稿済みにする
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
