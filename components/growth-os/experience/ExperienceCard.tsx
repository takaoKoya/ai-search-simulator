"use client";

import { useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setExperienceConfidenceAction, deleteExperienceAction } from "@/lib/growth-os/actions";
import type { ExperienceConfidence, ExperienceLibraryItem } from "@/lib/growth-os/types";

const CONFIDENCE_LABEL: Record<ExperienceConfidence, string> = {
  VERIFIED_BY_USER: "本人確認済み(AIが使用可)",
  NEEDS_REVIEW: "要確認(AIは使用しません)",
  UNVERIFIED: "未確認(AIは使用しません)",
};

const CONFIDENCE_VARIANT: Record<ExperienceConfidence, "success" | "warning" | "neutral"> = {
  VERIFIED_BY_USER: "success",
  NEEDS_REVIEW: "warning",
  UNVERIFIED: "neutral",
};

export function ExperienceCard({ experience }: { experience: ExperienceLibraryItem }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-neutral-900">{experience.title}</p>
          <Badge variant={CONFIDENCE_VARIANT[experience.confidence]}>{CONFIDENCE_LABEL[experience.confidence]}</Badge>
        </div>
        <p className="text-sm whitespace-pre-wrap text-neutral-700">{experience.summary}</p>
        {experience.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {experience.tags.map((tag) => (
              <Badge key={tag} variant="neutral">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          {experience.confidence !== "VERIFIED_BY_USER" && (
            <Button
              size="md"
              disabled={isPending}
              onClick={() => startTransition(() => setExperienceConfidenceAction(experience.id, "VERIFIED_BY_USER"))}
            >
              これは本当
            </Button>
          )}
          {experience.confidence !== "UNVERIFIED" && (
            <Button
              size="md"
              className="bg-white text-neutral-900 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
              disabled={isPending}
              onClick={() => startTransition(() => setExperienceConfidenceAction(experience.id, "UNVERIFIED"))}
            >
              これは間違い
            </Button>
          )}
          <Button
            size="md"
            className="bg-white text-rose-600 ring-1 ring-inset ring-rose-100 hover:bg-rose-50"
            disabled={isPending}
            onClick={() => startTransition(() => deleteExperienceAction(experience.id))}
          >
            削除
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
