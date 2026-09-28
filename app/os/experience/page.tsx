import type { Metadata } from "next";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listExperienceLibrary } from "@/lib/growth-os/db/experienceLibrary";
import { createExperienceAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { ExperienceCard } from "@/components/growth-os/experience/ExperienceCard";

export const metadata: Metadata = { title: "Experience Library | note Growth OS" };

/**
 * Experience Library(セクション11)。AIが一人称の体験談を書くときに使ってよい、
 * 本人の実体験だけを保存する。「本当」「間違い」の確認前(NEEDS_REVIEW)はAIに渡さない。
 */
export default async function ExperienceLibraryPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const experiences = await listExperienceLibrary(supabase, userId);

  return (
    <div>
      <PageHeader
        title="Experience Library"
        subtitle="あなた自身の実体験だけをここに登録してください。AIはこれ以外の一人称エピソードを作りません。"
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>体験を追加</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createExperienceAction} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-gray-400" htmlFor="title">
                タイトル
              </label>
              <Input id="title" name="title" placeholder="例: 40代で転職活動をして苦労したこと" required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400" htmlFor="summary">
                内容(具体的に)
              </label>
              <Textarea id="summary" name="summary" rows={4} required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400" htmlFor="tags">
                タグ(カンマ区切り)
              </label>
              <Input id="tags" name="tags" placeholder="例: 転職, 会社員, 失敗談" />
            </div>
            <Button size="md" type="submit">
              追加する(登録後に本人確認が必要です)
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {experiences.length === 0 && <p className="text-sm text-gray-400">まだ体験が登録されていません。</p>}
        {experiences.map((experience) => (
          <ExperienceCard key={experience.id} experience={experience} />
        ))}
      </div>
    </div>
  );
}
