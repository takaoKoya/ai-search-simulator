"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ScreenShell, ScreenHeader, ScreenCard } from "@/components/yattoru/ScreenLayout";
import { TODAY_PLAN, type ChecklistItem } from "@/constants/todayPlan";
import {
  getChecklistServerSnapshot,
  getChecklistSnapshot,
  subscribeChecklist,
  toggleChecklistItem,
  type ChecklistState,
} from "@/lib/checklistStore";
import { HOME_ROUTE } from "@/lib/routes";

function ChecklistRow({ item, done }: { item: ChecklistItem; done: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => toggleChecklistItem(item.id)}
        aria-pressed={done}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/5"
      >
        <span
          aria-hidden
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors ${
            done
              ? "border-neutral-900 bg-neutral-900 dark:border-white dark:bg-white"
              : "border-neutral-300 dark:border-neutral-600"
          }`}
        >
          {done && <Check className="h-3.5 w-3.5 text-white dark:text-neutral-900" strokeWidth={3} />}
        </span>
        <span
          className={`text-sm font-medium transition-colors ${
            done
              ? "text-neutral-400 line-through dark:text-neutral-600"
              : "text-neutral-800 dark:text-neutral-200"
          }`}
        >
          {item.label}
        </span>
      </button>
    </li>
  );
}

export default function TaskView() {
  const checklistState: ChecklistState = useSyncExternalStore(
    subscribeChecklist,
    getChecklistSnapshot,
    getChecklistServerSnapshot
  );

  const { checklist } = TODAY_PLAN.task;
  const doneCount = checklist.filter((item) => checklistState[item.id]).length;
  const progress = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : 0;

  return (
    <ScreenShell>
      <ScreenHeader title="今日の目標" subtitle={TODAY_PLAN.task.title} />

      <ScreenCard>
        <ul className="space-y-1">
          {checklist.map((item) => (
            <ChecklistRow key={item.id} item={item} done={Boolean(checklistState[item.id])} />
          ))}
        </ul>

        <div className="mt-6">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <span id="task-progress-label">進捗</span>
            <span>{progress}%</span>
          </div>
          <div
            role="progressbar"
            aria-labelledby="task-progress-label"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10"
          >
            <div
              className="h-full rounded-full bg-neutral-900 transition-all duration-300 dark:bg-white"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <Link href={HOME_ROUTE} className={buttonVariants({ size: "lg", className: "mt-7 w-full" })}>
          完了
        </Link>
      </ScreenCard>
    </ScreenShell>
  );
}
