import type { Metadata } from "next";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listThreadsPosts } from "@/lib/growth-os/db/threads";
import { getIdeasByIds } from "@/lib/growth-os/db/ideas";
import { regenerateThreadsAction } from "@/lib/growth-os/actions";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { ThreadsPostCard } from "@/components/growth-os/threads/ThreadsPostCard";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Threads | note Growth OS" };

export default async function ThreadsPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const posts = await listThreadsPosts(supabase, userId);

  const ideaIds = Array.from(new Set(posts.map((p) => p.idea_id)));
  const ideas = await getIdeasByIds(supabase, userId, ideaIds);
  const ideaById = new Map(ideas.map((i) => [i.id, i]));

  const groups = ideaIds.map((ideaId) => ({
    idea: ideaById.get(ideaId),
    posts: posts.filter((p) => p.idea_id === ideaId),
  }));

  return (
    <div>
      <PageHeader title="Threads" subtitle="1テーマから5パターンを生成し、トーンを見ながら承認する" />

      {groups.length === 0 && (
        <p className="text-sm text-gray-400">
          まだThreads投稿がありません。Ideasから「Threadsを作る」を実行してください。
        </p>
      )}

      {groups.map(({ idea, posts: groupPosts }) => (
        <section key={idea?.id ?? "unknown"} className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900">{idea?.title ?? "(削除されたIdea)"}</h2>
            {idea && (
              <form action={regenerateThreadsAction.bind(null, idea.id)}>
                <Button
                  size="md"
                  type="submit"
                  className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                >
                  5パターン再生成
                </Button>
              </form>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groupPosts.map((post) => (
              <ThreadsPostCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
