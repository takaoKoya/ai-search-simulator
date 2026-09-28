import type { Metadata } from "next";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { aggregateByTheme, listContentMetrics } from "@/lib/growth-os/db/metrics";
import { listThreadsPosts } from "@/lib/growth-os/db/threads";
import { listNoteArticles } from "@/lib/growth-os/db/articles";
import { listProducts } from "@/lib/growth-os/db/products";
import { getSetting, SETTINGS_KEYS } from "@/lib/growth-os/db/settings";
import { addMetricAction, runAnalyticsAdviseAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { ThemePerformanceChart } from "@/components/growth-os/analytics/ThemePerformanceChart";
import { THEME_TAGS } from "@/lib/growth-os/types";
import type { AnalyticsRecommendation } from "@/lib/growth-os/agents/analyticsAdvisor";

export const metadata: Metadata = { title: "Analytics | note Growth OS" };

export default async function AnalyticsPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const [metrics, threadsPosts, articles, products, recommendation] = await Promise.all([
    listContentMetrics(supabase, userId),
    listThreadsPosts(supabase, userId),
    listNoteArticles(supabase, userId),
    listProducts(supabase, userId),
    getSetting<AnalyticsRecommendation & { generated_at: string }>(
      supabase,
      userId,
      SETTINGS_KEYS.ANALYTICS_RECOMMENDATION
    ),
  ]);

  const themePerformance = aggregateByTheme(metrics);

  return (
    <div>
      <PageHeader title="Analytics" subtitle="テーマ別成果を比較し、増やす/減らす/商品化すべきテーマを見極める" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>成果を記録</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addMetricAction} className="grid gap-3 md:grid-cols-3">
            <Select name="content" required className="md:col-span-3">
              <option value="">対象を選択</option>
              <optgroup label="Threads">
                {threadsPosts
                  .filter((t) => t.status === "PUBLISHED")
                  .map((t) => (
                    <option key={t.id} value={`THREADS_POST|${t.id}`}>
                      {t.pattern_type}: {t.body.slice(0, 30)}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="note">
                {articles
                  .filter((a) => a.status === "PUBLISHED")
                  .map((a) => (
                    <option key={a.id} value={`NOTE_ARTICLE|${a.id}`}>
                      {a.title}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Products">
                {products
                  .filter((p) => p.status === "LAUNCHED")
                  .map((p) => (
                    <option key={p.id} value={`PRODUCT|${p.id}`}>
                      {p.product_name}
                    </option>
                  ))}
              </optgroup>
            </Select>
            <Select name="theme_tag">
              <option value="">テーマ未分類</option>
              {THEME_TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Input type="date" name="metric_date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            <Input type="number" name="pv" placeholder="PV" min={0} />
            <Input type="number" name="likes" placeholder="スキ" min={0} />
            <Input type="number" name="follower_delta" placeholder="フォロー増減" />
            <Input type="number" name="sales_amount" placeholder="売上(円)" min={0} />
            <Input type="number" name="purchase_count" placeholder="購入数" min={0} />
            <div className="md:col-span-3">
              <Button size="md" type="submit">
                記録する
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>テーマ別成果</CardTitle>
        </CardHeader>
        <CardContent>
          <ThemePerformanceChart data={themePerformance} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>AIによるテーマ提案</CardTitle>
          <form action={runAnalyticsAdviseAction}>
            <Button
              size="md"
              type="submit"
              className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
            >
              AI分析を実行
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          {!recommendation ? (
            <p className="text-sm text-gray-400">まだ分析結果がありません。「AI分析を実行」してください。</p>
          ) : (
            <div className="space-y-3 text-sm">
              <ThemeTagList label="増やすべきテーマ" variant="success" tags={recommendation.increase_themes} />
              <ThemeTagList label="減らすべきテーマ" variant="critical" tags={recommendation.decrease_themes} />
              <ThemeTagList label="商品化すべきテーマ" variant="accent" tags={recommendation.productize_themes} />
              <p className="text-gray-500">{recommendation.reasoning}</p>
              <p className="text-xs text-gray-400">
                最終分析日: {new Date(recommendation.generated_at).toLocaleString("ja-JP")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeTagList({
  label,
  tags,
  variant,
}: {
  label: string;
  tags: string[];
  variant: "success" | "critical" | "accent";
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-gray-400">{label}:</span>
      {tags.map((tag) => (
        <Badge key={tag} variant={variant}>
          {tag}
        </Badge>
      ))}
    </div>
  );
}
