"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TODAY_PLAN } from "@/constants/todayPlan";
import {
  getChecklistServerSnapshot,
  getChecklistSnapshot,
  subscribeChecklist,
  toggleChecklistItem,
} from "@/lib/checklistStore";

const HOME_ROUTE = "/home";

export default function TaskView() {
  const router = useRouter();
  const checklistState = useSyncExternalStore(
    subscribeChecklist,
    getChecklistSnapshot,
    getChecklistServerSnapshot
  );

  const { checklist } = TODAY_PLAN.task;
  const doneCount = checklist.filter((item) => checklistState[item.id]).length;
  const progress = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : 0;

  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-neutral-50 to-neutral-100 px-5 py-16 dark:from-neutral-950 dark:to-neutral-900">
      <div className="w-full max-w-md">
        <header className="mb-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-neutral-400 uppercase dark:text-neutral-600">
            YATTORU
          </p>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl dark:text-white">
            今日の目標
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            {TODAY_PLAN.task.title}
          </p>
        </header>

        <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.18)] sm:p-8 dark:border-white/10 dark:bg-neutral-900">
          <ul className="space-y-1">
            {checklist.map((item) => {
              const done = Boolean(checklistState[item.id]);
              return (
                <li key={item.id}>
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
                      {done && (
                        <Check
                          className="h-3.5 w-3.5 text-white dark:text-neutral-900"
                          strokeWidth={3}
                        />
                      )}
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
            })}
          </ul>

          <div className="mt-6">
            <div className="flex items-center justify-between text-xs font-medium text-neutral-500 dark:text-neutral-400">
              <span>進捗</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-neutral-900 transition-all duration-300 dark:bg-white"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <Button size="lg" className="mt-7 w-full" onClick={() => router.push(HOME_ROUTE)}>
            完了
          </Button>
        </section>
      </div>
    </main>
  );
}
