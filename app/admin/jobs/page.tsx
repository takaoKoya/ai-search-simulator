import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { formatDateTime, JOB_STATUS_LABELS, TARGET_LABELS } from "@/lib/jobs/labels";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, targetType: true, status: true, createdAt: true, _count: { select: { applicants: true } } },
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">求人一覧</h1>
        <div className="flex gap-2">
          <Link href="/admin/analytics" className={buttonVariants()}>
            アナリティクス
          </Link>
          <Link href="/admin/jobs/new" className={buttonVariants()}>
            新規作成
          </Link>
        </div>
      </div>
      {jobs.length === 0 ? (
        <p className="text-sm text-neutral-500">保存された求人はまだありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-3">職種</th>
                <th className="px-4 py-3">ターゲット層</th>
                <th className="px-4 py-3">ステータス</th>
                <th className="px-4 py-3">応募者</th>
                <th className="px-4 py-3">作成日</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/jobs/${job.id}`} className="underline-offset-2 hover:underline">
                      {job.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{TARGET_LABELS[job.targetType]}</td>
                  <td className="px-4 py-3">{JOB_STATUS_LABELS[job.status]}</td>
                  <td className="px-4 py-3">{job._count.applicants}</td>
                  <td className="whitespace-nowrap px-4 py-3">{formatDateTime(job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
