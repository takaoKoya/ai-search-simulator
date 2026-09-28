import { Badge } from "@/components/ui/badge";
import { CTA_TYPE_LABELS, type NoteArticle } from "@/lib/growth-os/types";

export function OutlineCard({ article }: { article: NoteArticle }) {
  if (article.title_candidates.length === 0) return null;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-2 text-xs font-semibold text-gray-400 uppercase">タイトル案(5案)</p>
        <div className="space-y-2">
          {article.title_candidates.map((c, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 ${
                c.title === article.title ? "border-neutral-900 bg-neutral-50" : "border-gray-100"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-neutral-900">{c.title}</p>
                {c.title === article.title && <Badge variant="accent">AI推奨/採用中</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-400">
                <span>型: {c.type}</span>
                <span>クリック力 {c.click_score}</span>
                <span>信頼性 {c.trust_score}</span>
                <span>具体性 {c.specificity_score}</span>
                <span>煽り度 {c.sales_smell_score}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="リード文" value={article.lead} />
        <Field label="読者の悩み" value={article.reader_problem} />
        <Field label="この記事の約束" value={article.promise} />
      </div>

      {article.cta_type && (
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">CTA</p>
          <p className="text-neutral-700">
            <Badge variant="neutral">{CTA_TYPE_LABELS[article.cta_type]}</Badge>{" "}
            <span className="ml-1">{article.cta_text}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-400 uppercase">{label}</p>
      <p className="text-neutral-700">{value ?? "-"}</p>
    </div>
  );
}
