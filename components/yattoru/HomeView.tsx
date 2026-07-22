"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ScreenShell, ScreenHeader, ScreenCard } from "@/components/yattoru/ScreenLayout";
import { getGreeting } from "@/lib/greeting";
import { TODAY_PLAN } from "@/constants/todayPlan";
import { TASK_TODAY_ROUTE } from "@/lib/routes";

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
  const greeting = useGreeting();
  const { availableMinutes, task } = TODAY_PLAN;

  return (
    <ScreenShell>
      <ScreenHeader
        eyebrowSlot={
          <div className="min-h-[1.25rem]">
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
        }
        title={`今日は${availableMinutes}分使えます。`}
        subtitle={
          <>
            今日やることは
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">1つ</span>
            です。
          </>
        }
      />

      <ScreenCard>
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

        <Link href={TASK_TODAY_ROUTE} className={buttonVariants({ size: "lg", className: "mt-7 w-full" })}>
          開始
          <ArrowRight aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        </Link>
      </ScreenCard>
    </ScreenShell>
  );
}
