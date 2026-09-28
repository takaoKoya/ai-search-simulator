"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { manualEditArticleSectionAction } from "@/lib/growth-os/actions";
import type { ArticleSection } from "@/lib/growth-os/types";

export function SectionEditor({ section }: { section: ArticleSection }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.content);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="border-b border-gray-100 py-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-neutral-900">{section.heading}</h3>
        <div className="flex items-center gap-2">
          {section.manual_edited && <Badge variant="neutral">手動編集済み</Badge>}
          {!editing && (
            <Button
              size="md"
              className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              編集
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} className="text-sm" />
          <div className="flex gap-2">
            <Button
              size="md"
              disabled={isPending}
              onClick={() => {
                const formData = new FormData();
                formData.set("section_id", section.id);
                formData.set("content", draft);
                startTransition(async () => {
                  await manualEditArticleSectionAction(formData);
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
                setDraft(section.content);
                setEditing(false);
              }}
            >
              キャンセル
            </Button>
          </div>
        </div>
      ) : section.content ? (
        <p className="text-sm whitespace-pre-wrap text-neutral-800">{section.content}</p>
      ) : (
        <p className="text-sm text-gray-400">まだ執筆されていません。</p>
      )}
    </div>
  );
}
