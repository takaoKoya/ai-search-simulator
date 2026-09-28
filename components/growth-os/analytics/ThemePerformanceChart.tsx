"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ThemePerformance } from "@/lib/growth-os/db/metrics";

export function ThemePerformanceChart({ data }: { data: ThemePerformance[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">まだメトリクスが記録されていません。</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F1F1" />
        <XAxis dataKey="theme_tag" angle={-30} textAnchor="end" interval={0} height={60} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="pv" name="PV" fill="#171B24" radius={[4, 4, 0, 0]} />
        <Bar dataKey="likes" name="スキ" fill="#93672B" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
