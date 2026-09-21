"use client";

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import { IDEA_SCORE_CRITERIA, ideaScoreByCriterion, type ContentIdea } from "@/lib/growth-os/types";

/** 9軸を「満点に対する達成率(%)」に正規化して描画する(配点が5〜15点とバラバラなため)。 */
export function ScoreRadarChart({ idea }: { idea: ContentIdea }) {
  const byCriterion = ideaScoreByCriterion(idea);
  const data = IDEA_SCORE_CRITERIA.map((c) => ({
    label: c.label,
    achievement: Math.round(((byCriterion[c.key] ?? 0) / c.weight) * 100),
    raw: `${byCriterion[c.key] ?? 0} / ${c.weight}点`,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} outerRadius="75%">
        <PolarGrid stroke="#E5E7EB" />
        <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "#4B5563" }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
        <Radar dataKey="achievement" stroke="#93672B" fill="#93672B" fillOpacity={0.25} />
        <Tooltip formatter={(_value, _name, entry) => [entry.payload.raw, "配点"]} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
