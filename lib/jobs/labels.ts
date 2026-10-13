import type { JobStatus, TargetType, ApplicantStatus } from "@/lib/generated/prisma/client";

export const TARGET_LABELS: Record<TargetType, string> = {
  ALBAIT: "アルバイト層",
  SPECIALIST: "専門職層",
  GENERAL: "一般職層",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: "下書き",
  PUBLISHED: "公開中",
  CLOSED: "終了",
};

export const APPLICANT_STATUS_LABELS: Record<ApplicantStatus, string> = {
  NEW: "新規",
  SCREENING: "スクリーニング中",
  PASSED: "通過",
  REJECTED: "不通過",
  PENDING: "要確認",
  INTERVIEW_SCHEDULED: "面接予約済",
  HIRED: "採用",
};

export const APPLICANT_STATUS_STYLES: Record<ApplicantStatus, string> = {
  NEW: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  SCREENING: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  PASSED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  INTERVIEW_SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  HIRED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(date);
}
