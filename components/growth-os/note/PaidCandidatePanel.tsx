"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { evaluatePaidCandidateAction, createPaidNoteFromFreeArticleAction } from "@/lib/growth-os/actions";
import type { NoteArticle } from "@/lib/growth-os/types";

const AXES: { key: "problem_depth" | "actionability" | "repeat_value" | "specificity" | "transformation_value" | "purchase_intent"; label: string }[] = [
  { key: "problem_depth", label: "問題の深さ" },
  { key: "actionability", label: "行動可能性" },
  { key: "repeat_value", label: "反復参照価値" },
  { key: "specificity", label: "具体性" },
  { key: "transformation_value", label: "変化をもたらす価値" },
  { key: "purchase_intent", label: "購入意欲の見込み" },
];

/** 有料note候補判定(セクション24)。無料note公開後、人間が任意で実行する。 */
export function PaidCandidatePanel({ article }: { article: NoteArticle }) {
  const [isPending, startTransition] = useTransition();

  if (article.type !== "FREE") return null;

  const evaluation = article.paid_candidate_evaluation;

  return (
    <div className="space-y-3">
      {!evaluation ? (
        <Button
          size="md"
          className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
          disabled={isPending}
          onClick={() => startTransition(() => evaluatePaidCandidateAction(article.id))}
        >
          有料note候補か判定する
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {evaluation.is_paid_candidate ? (
              <Badge variant="success">有料note候補あり</Badge>
            ) : (
              <Badge variant="neutral">現時点では有料化は推奨されません</Badge>
            )}
          </div>
          <p className="text-sm text-neutral-700">{evaluation.reasoning}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {AXES.map(({ key, label }) => (
              <div key={key}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-mono text-gray-400">{evaluation[key]}</span>
                </div>
                <Progress value={evaluation[key]} />
              </div>
            ))}
          </div>
          {evaluation.is_paid_candidate && (
            <Button
              size="md"
              disabled={isPending}
              onClick={() => startTransition(() => createPaidNoteFromFreeArticleAction(article.id))}
            >
              有料noteを作る
            </Button>
          )}
        </>
      )}
    </div>
  );
}
