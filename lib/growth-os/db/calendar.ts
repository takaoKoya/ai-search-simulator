import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarItem, CalendarItemType } from "@/lib/growth-os/types";

export async function listCalendarItems(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_calendar_items")
    .select("*")
    .eq("user_id", userId)
    .order("scheduled_date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CalendarItem[];
}

export async function createCalendarItem(
  supabase: SupabaseClient,
  userId: string,
  input: { item_type: CalendarItemType; ref_id: string; scheduled_date: string; scheduled_time?: string | null }
) {
  const { data, error } = await supabase
    .from("gos_calendar_items")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as CalendarItem;
}
