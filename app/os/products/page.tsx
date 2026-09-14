import type { Metadata } from "next";
import { requireGrowthOsUser } from "@/lib/growth-os/auth";
import { listProducts } from "@/lib/growth-os/db/products";
import { listPublishedFreeArticles } from "@/lib/growth-os/db/articles";
import { generateProductSuggestionAction } from "@/lib/growth-os/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/growth-os/shared/PageHeader";
import { ProductStatusSelect } from "@/components/growth-os/products/ProductStatusSelect";

export const metadata: Metadata = { title: "Products | note Growth OS" };

export default async function ProductsPage() {
  const { supabase, userId } = await requireGrowthOsUser();
  const [products, freeArticles] = await Promise.all([
    listProducts(supabase, userId),
    listPublishedFreeArticles(supabase, userId),
  ]);

  const proposedSourceIds = new Set(products.map((p) => p.source_content_id));

  return (
    <div>
      <PageHeader title="Products" subtitle="反応の良かった無料note記事から商品化を提案する" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>商品化候補の記事</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {freeArticles.length === 0 && (
            <p className="text-sm text-gray-400">公開済みの無料note記事がまだありません。</p>
          )}
          {freeArticles.map((article) => (
            <div key={article.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
              <span className="truncate text-sm text-neutral-900">{article.title}</span>
              <form action={generateProductSuggestionAction.bind(null, article.id)}>
                <Button
                  size="md"
                  type="submit"
                  className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                >
                  {proposedSourceIds.has(article.id) ? "商品案を再生成" : "商品案を生成"}
                </Button>
              </form>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {products.map((product) => (
          <Card key={product.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{product.product_name}</CardTitle>
              <ProductStatusSelect productId={product.id} status={product.status} />
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-neutral-700">
              <p className="font-mono text-gray-500">
                推奨価格: ¥{product.recommended_price?.toLocaleString() ?? "未設定"} ・ 確度スコア:{" "}
                {product.product_score ?? "-"}
              </p>
              <p>
                <span className="font-medium">対象:</span> {product.target}
              </p>
              <p>
                <span className="font-medium">課題:</span> {product.problem}
              </p>
              <p>
                <span className="font-medium">解決策:</span> {product.solution}
              </p>
              {Array.isArray(product.outline) && (
                <ul className="list-disc pl-5 text-gray-600">
                  {(product.outline as string[]).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {products.length === 0 && <p className="mt-4 text-sm text-gray-400">まだ商品提案がありません。</p>}
    </div>
  );
}
