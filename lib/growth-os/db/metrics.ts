import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentMetric, MetricContentType } from "@/lib/growth-os/types";

export interface UpsertMetricInput {
  content_type: MetricContentType;
  content_id: string;
  metric_date: string;
  pv?: number;
  likes?: number;
  follower_delta?: number;
  sales_amount?: number;
  purchase_count?: number;
  theme_tag?: string | null;
}

export async function upsertContentMetric(supabase: SupabaseClient, userId: string, input: UpsertMetricInput) {
  const like_rate = input.pv && input.pv > 0 ? Number((((input.likes ?? 0) / input.pv) * 100).toFixed(2)) : null;

  const { data, error } = await supabase
    .from("gos_content_metrics")
    .upsert({ ...input, user_id: userId, like_rate }, { onConflict: "content_id,metric_date" })
    .select("*")
    .single();

  if (error) throw error;
  return data as ContentMetric;
}

export async function listContentMetrics(supabase: SupabaseClient, userId: string, sinceDate?: string) {
  let query = supabase.from("gos_content_metrics").select("*").eq("user_id", userId);
  if (sinceDate) query = query.gte("metric_date", sinceDate);

  const { data, error } = await query.order("metric_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ContentMetric[];
}

export interface ThemePerformance {
  theme_tag: string;
  pv: number;
  likes: number;
  sales_amount: number;
  purchase_count: number;
}

export function aggregateByTheme(metrics: ContentMetric[]): ThemePerformance[] {
  const byTheme = new Map<string, ThemePerformance>();
  for (const m of metrics) {
    const tag = m.theme_tag ?? "未分類";
    const current = byTheme.get(tag) ?? { theme_tag: tag, pv: 0, likes: 0, sales_amount: 0, purchase_count: 0 };
    current.pv += m.pv;
    current.likes += m.likes;
    current.sales_amount += m.sales_amount;
    current.purchase_count += m.purchase_count;
    byTheme.set(tag, current);
  }
  return Array.from(byTheme.values()).sort((a, b) => b.pv - a.pv);
}
