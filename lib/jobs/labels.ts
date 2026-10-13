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
  INTERVIEW_SCHEDULED: "面接予約済",
  HIRED: "採用",
};

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(date);
}
