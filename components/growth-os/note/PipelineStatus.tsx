import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_ARTICLE_STAGE_LABELS, NOTE_ARTICLE_STAGE_ORDER, type NoteArticleStage } from "@/lib/growth-os/types";

export function PipelineStatus({ currentStage }: { currentStage: NoteArticleStage }) {
  const currentIndex = NOTE_ARTICLE_STAGE_ORDER.indexOf(currentStage);

  return (
    <ol className="flex flex-col gap-2">
      {NOTE_ARTICLE_STAGE_ORDER.map((stage, index) => {
        const done = index < currentIndex || currentStage === "DONE";
        const active = index === currentIndex && currentStage !== "DONE";
        return (
          <li key={stage} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done ? "bg-emerald-600 text-white" : active ? "bg-neutral-900 text-white" : "bg-gray-100 text-gray-400"
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={cn(active ? "font-semibold text-neutral-900" : "text-gray-500")}>
              {NOTE_ARTICLE_STAGE_LABELS[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
