import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { getThreadsPost } from "@/lib/growth-os/db/threads";
import { getIdea } from "@/lib/growth-os/db/ideas";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { ThreadsPostCard } from "@/components/growth-os/threads/ThreadsPostCard";
import { THREADS_PATTERN_LABELS } from "@/lib/growth-os/types";

export const metadata: Metadata = { title: "Threads detail | note Growth OS" };

export default async function ThreadsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireGrowthOsUser();

  const post = await getThreadsPost(supabase, userId, id);
  if (!post) notFound();

  const idea = await getIdea(supabase, userId, post.idea_id);

  return (
    <div>
      <PageHeader title={idea?.title ?? "Threads投稿"} subtitle={THREADS_PATTERN_LABELS[post.pattern_type]} />
      <div className="max-w-xl">
        <ThreadsPostCard post={post} />
      </div>
    </div>
  );
}
