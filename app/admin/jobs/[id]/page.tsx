import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicantActions } from "@/components/admin/ApplicantActions";
import { ChannelAnalytics } from "@/components/admin/ChannelAnalytics";
import { JobStatusControl } from "@/components/admin/JobStatusControl";
import { Card } from "@/components/ui/card";
import { getChannelSummary } from "@/lib/analytics/query";
import { DEFAULT_INTERVIEW_TEMPLATE, toJstInputValue } from "@/lib/applicants/notify";
import { DONE_STEP } from "@/lib/line/flow";
import { prisma } from "@/lib/db";
import { APPLICANT_STATUS_LABELS, APPLICANT_STATUS_STYLES, formatDateTime, JOB_STATUS_LABELS, TARGET_LABELS } from "@/lib/jobs/labels";
import { generatedJobSchema } from "@/lib/jobs/schema";

export const dynamic = "force-dynamic";

const SNS_LABELS = { x: "X (Twitter)", instagram: "Instagram", line: "LINE" } as const;

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    include: { applicants: { orderBy: { createdAt: "desc" } } },
  });
  if (!job) notFound();

  const summary = await getChannelSummary(job.id);
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const content = generatedJobSchema.pick({ snsPostText: true, lineQuestions: true }).safeParse(job);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <Link href="/admin/jobs" className="text-sm text-neutral-500 hover:underline">
        ← 求人一覧
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{job.title}</h1>
        <p className="text-sm text-neutral-500">
          {TARGET_LABELS[job.targetType]} ／ {JOB_STATUS_LABELS[job.status]} ／ {formatDateTime(job.createdAt)}
        </p>
        <p className="text-sm">
          {[job.location, job.salary, job.conditions].filter(Boolean).join(" ／ ")}
        </p>
        <JobStatusControl id={job.id} status={job.status} />
      </div>

      {content.success ? (
        <>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-neutral-500">SNS投稿文</h2>
            {(Object.keys(SNS_LABELS) as (keyof typeof SNS_LABELS)[]).map((k) => (
              <div key={k} className="mt-3">
                <h3 className="text-xs font-semibold">{SNS_LABELS[k]}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{content.data.snsPostText[k]}</p>
              </div>
            ))}
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-neutral-500">Indeed求人原稿</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">{job.indeedText}</p>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-neutral-500">LINEスクリーニング質問</h2>
            <ol className="mt-2 flex flex-col gap-3">
              {content.data.lineQuestions.map((q, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium">
                    Q{i + 1}. {q.question}
                  </p>
                  <ul className="mt-1 list-inside list-disc text-neutral-600 dark:text-neutral-400">
                    {q.options.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </Card>
        </>
      ) : (
        <p role="alert" className="text-sm text-red-600">
          保存された生成データの形式が不正です。
        </p>
      )}

      <ChannelAnalytics title="チャネル別の流入・応募" summary={summary} />

      {job.status === "PUBLISHED" && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-neutral-500">計測リンク</h2>
          <p className="mt-1 text-xs text-neutral-500">
            各媒体にこのリンクを掲載すると、PV・応募がチャネル別に集計されます（utm_source: line / tiktok / indeed / x / instagram）。
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {["line", "tiktok", "indeed", "x", "instagram"].map((src) => (
              <li key={src} className="break-all font-mono">
                {`${base}/r/${job.id}?utm_source=${src}`}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-neutral-500">応募者（{job.applicants.length}）</h2>
        {job.applicants.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">まだ応募者はいません。</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
            {job.applicants.map((a) => {
              const answers = Array.isArray(a.answers) ? (a.answers as string[]) : [];
              return (
                <li key={a.id} className="flex flex-col gap-2 py-4 text-sm">
                  <div className="flex items-center gap-3">
                    {a.linePictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external LINE CDN avatar
                      <img src={a.linePictureUrl} alt="" width={40} height={40} className="size-10 rounded-full object-cover" />
                    ) : (
                      <div aria-hidden className="size-10 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.lineDisplayName ?? `LINE…${a.lineUserId.slice(-6)}`}</p>
                      <p className="text-xs text-neutral-500">応募日 {formatDateTime(a.createdAt)}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${APPLICANT_STATUS_STYLES[a.status]}`}
                    >
                      {APPLICANT_STATUS_LABELS[a.status]}
                    </span>
                  </div>
                  {a.score !== null && (
                    <div className="flex items-center gap-3">
                      <span className="w-16 text-xs text-neutral-500">スコア</span>
                      <div
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={a.score}
                        aria-label="スコア"
                        className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
                      >
                        <div className="h-full bg-neutral-900 dark:bg-white" style={{ width: `${a.score}%` }} />
                      </div>
                      <span className="w-10 text-right font-semibold tabular-nums">{a.score}</span>
                    </div>
                  )}
                  {a.evaluation && (
                    <p className="rounded-lg bg-neutral-50 p-3 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                      <span className="mb-1 block text-xs font-semibold text-neutral-500">AI評価（参考）</span>
                      {a.evaluation}
                    </p>
                  )}
                  <p className="text-neutral-600 dark:text-neutral-400">
                    回答: {answers.join(" / ") || "—"}
                    <br />
                    面接希望: {a.interviewAt ? formatDateTime(a.interviewAt) : "—"}
                    {a.interviewConfirmedAt && (
                      <>
                        <br />
                        面接確定: {formatDateTime(a.interviewConfirmedAt)}
                      </>
                    )}
                  </p>
                  <ApplicantActions
                    id={a.id}
                    status={a.status}
                    completed={a.step >= DONE_STEP}
                    defaultTemplate={DEFAULT_INTERVIEW_TEMPLATE}
                    defaultConfirmedAt={toJstInputValue(a.interviewConfirmedAt ?? a.interviewAt)}
                    notifiedAt={a.notifiedAt ? formatDateTime(a.notifiedAt) : null}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
