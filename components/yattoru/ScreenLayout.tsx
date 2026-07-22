import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ScreenShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-neutral-50 to-neutral-100 px-5 py-16 dark:from-neutral-950 dark:to-neutral-900">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  eyebrowSlot,
  align = "left",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrowSlot?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <header className={cn("mb-8", align === "center" && "text-center")}>
      <p className="text-xs font-semibold tracking-[0.2em] text-neutral-400 uppercase dark:text-neutral-600">
        YATTORU
      </p>
      {eyebrowSlot && <div className="mt-5">{eyebrowSlot}</div>}
      <h1
        className={cn(
          "text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl dark:text-white",
          eyebrowSlot ? "mt-2" : "mt-5"
        )}
      >
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>
      )}
    </header>
  );
}

export function ScreenCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.18)] sm:p-8 dark:border-white/10 dark:bg-neutral-900",
        className
      )}
    >
      {children}
    </section>
  );
}
