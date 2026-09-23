import type { Metadata } from "next";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listCalendarItems } from "@/lib/growth-os/db/calendar";
import { listThreadsPosts } from "@/lib/growth-os/db/threads";
import { listNoteArticles } from "@/lib/growth-os/db/articles";
import { listProducts } from "@/lib/growth-os/db/products";
import { addCalendarItemAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";

export const metadata: Metadata = { title: "Calendar | note Growth OS" };

const ITEM_TYPE_LABELS: Record<string, string> = {
  THREADS: "Threads",
  NOTE_FREE: "無料note",
  NOTE_PAID: "有料note",
  PRODUCT_LAUNCH: "商品発売",
};

export default async function CalendarPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const [items, threadsPosts, articles, products] = await Promise.all([
    listCalendarItems(supabase, userId),
    listThreadsPosts(supabase, userId),
    listNoteArticles(supabase, userId),
    listProducts(supabase, userId),
  ]);

  const byDate = new Map<string, typeof items>();
  for (const item of items) {
    const list = byDate.get(item.scheduled_date) ?? [];
    list.push(item);
    byDate.set(item.scheduled_date, list);
  }
  const dates = Array.from(byDate.keys()).sort();

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Threads・無料note・有料note・商品発売の予定を横断表示する" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>予定を追加</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addCalendarItemAction} className="grid gap-3 md:grid-cols-3">
            <Select name="item" required className="md:col-span-2">
              <option value="">対象を選択</option>
              <optgroup label="Threads(承認済み)">
                {threadsPosts
                  .filter((t) => t.status === "APPROVED" || t.status === "PUBLISHED")
                  .map((t) => (
                    <option key={t.id} value={`THREADS|${t.id}`}>
                      {t.pattern_type}: {t.body.slice(0, 30)}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="note(承認済み)">
                {articles
                  .filter((a) => a.status === "APPROVED" || a.status === "PUBLISHED")
                  .map((a) => (
                    <option key={a.id} value={`${a.type === "PAID" ? "NOTE_PAID" : "NOTE_FREE"}|${a.id}`}>
                      {a.title}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="商品発売">
                {products
                  .filter((p) => p.status === "READY" || p.status === "LAUNCHED")
                  .map((p) => (
                    <option key={p.id} value={`PRODUCT_LAUNCH|${p.id}`}>
                      {p.product_name}
                    </option>
                  ))}
              </optgroup>
            </Select>
            <Input type="date" name="scheduled_date" required />
            <Input type="time" name="scheduled_time" />
            <div className="md:col-span-3">
              <Button size="md" type="submit">
                予定に追加
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {dates.length === 0 && <p className="text-sm text-gray-400">まだ予定がありません。</p>}
        {dates.map((date) => (
          <Card key={date}>
            <CardContent className="py-4">
              <p className="mb-2 font-mono text-sm font-semibold text-neutral-900">
                {new Date(date).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}
              </p>
              <div className="space-y-1">
                {(byDate.get(date) ?? []).map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm text-gray-600">
                    <Badge variant="neutral">{ITEM_TYPE_LABELS[item.item_type]}</Badge>
                    {item.scheduled_time && <span className="font-mono text-xs">{item.scheduled_time}</span>}
                    <span>{item.status}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
