import type { Metadata } from "next";
import Link from "next/link";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listIdeas } from "@/lib/growth-os/db/ideas";
import { createIdeaManuallyAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { TierBadge, StatusBadge } from "@/components/growth-os/shared/StatusBadge";
import { GROWTH_OS_IDEAS_ROUTE } from "@/lib/routes";
import type { IdeaTier } from "@/lib/growth-os/types";

export const metadata: Metadata = { title: "Ideas | note Growth OS" };

const TIER_ORDER: IdeaTier[] = ["TOP", "CANDIDATE", "HOLD", "REJECT"];

export default async function IdeasPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const ideas = await listIdeas(supabase, userId);

  return (
    <div>
      <PageHeader title="Ideas" subtitle="9軸スコアリングでコンテンツ候補を評価する(合計100点)" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>新規登録</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createIdeaManuallyAction} className="grid gap-3 md:grid-cols-2">
            <Input name="title" placeholder="テーマ(必須)" required className="md:col-span-2" />
            <Textarea name="summary" placeholder="概要" className="md:col-span-2" rows={2} />
            <div className="md:col-span-2">
              <Button size="md" type="submit">
                登録する
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {TIER_ORDER.map((tier) => {
        const tierIdeas = ideas.filter((i) => i.tier === tier);
        if (tierIdeas.length === 0) return null;
        return (
          <div key={tier} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <TierBadge tier={tier} />
              <span className="text-xs text-gray-400">{tierIdeas.length}件</span>
            </div>
            <div className="grid gap-3">
              {tierIdeas.map((idea) => (
                <Link key={idea.id} href={`${GROWTH_OS_IDEAS_ROUTE}/${idea.id}`}>
                  <Card className="transition-shadow hover:shadow-md">
                    <CardContent className="flex items-center justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-neutral-900">{idea.title}</p>
                        {idea.summary && <p className="mt-1 truncate text-xs text-gray-400">{idea.summary}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-sm text-gray-500">{idea.total_score}点</span>
                        <StatusBadge status={idea.status} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {ideas.length === 0 && <p className="text-sm text-gray-400">まだIdeaがありません。</p>}
    </div>
  );
}
