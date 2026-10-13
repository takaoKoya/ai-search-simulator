import Link from "next/link";
import { notFound } from "next/navigation";
import { JobStatusControl } from "@/components/admin/JobStatusControl";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { APPLICANT_STATUS_LABELS, formatDateTime, JOB_STATUS_LABELS, TARGET_LABELS } from "@/lib/jobs/labels";
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

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-neutral-500">応募者（{job.applicants.length}）</h2>
        {job.applicants.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">まだ応募者はいません。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">応募者</th>
                  <th className="py-2 pr-4">ステータス</th>
                  <th className="py-2 pr-4">回答</th>
                  <th className="py-2 pr-4">面接希望</th>
                  <th className="py-2">応募日</th>
                </tr>
              </thead>
              <tbody>
                {job.applicants.map((a) => {
                  const answers = Array.isArray(a.answers) ? (a.answers as string[]) : [];
                  return (
                    <tr key={a.id} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                      <td className="py-2 pr-4">{a.displayName ?? `LINE…${a.lineUserId.slice(-6)}`}</td>
                      <td className="py-2 pr-4">{APPLICANT_STATUS_LABELS[a.status]}</td>
                      <td className="py-2 pr-4">{answers.join(" / ") || "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-4">{a.interviewAt ? formatDateTime(a.interviewAt) : "—"}</td>
                      <td className="whitespace-nowrap py-2">{formatDateTime(a.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
