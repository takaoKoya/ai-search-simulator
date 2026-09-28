import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_ARTICLE_STATUS_LABELS, NOTE_ARTICLE_STATUS_ORDER, type NoteArticleStatus } from "@/lib/growth-os/types";

export function PipelineStatus({ currentStatus }: { currentStatus: NoteArticleStatus }) {
  const currentIndex = NOTE_ARTICLE_STATUS_ORDER.indexOf(currentStatus);
  const terminal = currentStatus === "PUBLISHED" || currentStatus === "ANALYZED" || currentStatus === "REJECTED";

  return (
    <ol className="flex flex-col gap-2">
      {NOTE_ARTICLE_STATUS_ORDER.map((status, index) => {
        const done = index < currentIndex || terminal;
        const active = index === currentIndex && !terminal;
        return (
          <li key={status} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done ? "bg-emerald-600 text-white" : active ? "bg-neutral-900 text-white" : "bg-gray-100 text-gray-400"
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={cn(active ? "font-semibold text-neutral-900" : "text-gray-500")}>
              {NOTE_ARTICLE_STATUS_LABELS[status]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
