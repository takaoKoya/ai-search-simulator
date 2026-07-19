"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getGreeting } from "@/lib/greeting";
import { TODAY_PLAN } from "@/constants/todayPlan";

const TODAY_TASK_ROUTE = "/task/today";

function subscribeToNothing() {
  return () => {};
}

function getServerGreetingSnapshot() {
  return null;
}

// 現在時刻に応じた挨拶はサーバーとクライアントでタイムゾーンがずれるため、
// useSyncExternalStoreでクライアント確定後にのみ描画してハイドレーション不整合を避ける。
function useGreeting() {
  return useSyncExternalStore(subscribeToNothing, getGreeting, getServerGreetingSnapshot);
}

export default function HomeView() {
  const router = useRouter();
  const greeting = useGreeting();

  const { availableMinutes, task } = TODAY_PLAN;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-neutral-50 to-neutral-100 px-5 py-16 dark:from-neutral-950 dark:to-neutral-900">
      <div className="w-full max-w-md">
        <header className="mb-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-neutral-400 uppercase dark:text-neutral-600">
            YATTORU
          </p>

          <div className="mt-5 min-h-[1.25rem]">
            {greeting ? (
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                <span aria-hidden className="mr-1.5">
                  {greeting.icon}
                </span>
                {greeting.text}
              </p>
            ) : (
              <div
                aria-hidden
                className="h-5 w-36 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800"
              />
            )}
          </div>

          <h1 className="mt-2 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl dark:text-white">
            今日は{availableMinutes}分使えます。
          </h1>

          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            今日やることは
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              1つ
            </span>
            です。
          </p>
        </header>

        <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.18)] sm:p-8 dark:border-white/10 dark:bg-neutral-900">
          <span className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-500 dark:bg-white/10 dark:text-neutral-400">
            今日のタスク
          </span>

          <p className="mt-4 text-lg leading-relaxed font-bold text-neutral-900 sm:text-xl dark:text-white">
            {task.title}
          </p>

          <div className="mt-5 flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            <Clock aria-hidden className="h-4 w-4" strokeWidth={2} />
            完了予定：{task.estimatedMinutes}分
          </div>

          <Button
            size="lg"
            className="mt-7 w-full"
            onClick={() => router.push(TODAY_TASK_ROUTE)}
          >
            開始
            <ArrowRight aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          </Button>
        </section>
      </div>
    </main>
  );
}
