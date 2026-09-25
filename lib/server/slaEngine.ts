import type { TenantContext } from "@/lib/server/tenant";
import { computeSlaDueAt, type BusinessCalendar, type SlaDurationUnit } from "@/lib/server/businessCalendar";

export type SlaStatus = "ON_TRACK" | "DUE_SOON" | "BREACHED" | "COMPLETED";

/**
 * DUE_SOON kicks in inside the last 25% of the SLA window (bounded to at
 * most 4 business hours) — close enough to the deadline to escalate, not
 * so early that everything spends most of its life "due soon".
 */
const DUE_SOON_FRACTION = 0.25;
const DUE_SOON_MAX_MS = 4 * 3600_000;

export function computeSlaStatus(params: { dueAt: Date; startAt: Date; now: Date; resolved: boolean }): SlaStatus {
  if (params.resolved) return "COMPLETED";
  if (params.now.getTime() >= params.dueAt.getTime()) return "BREACHED";

  const totalWindowMs = params.dueAt.getTime() - params.startAt.getTime();
  const dueSoonWindowMs = Math.min(totalWindowMs * DUE_SOON_FRACTION, DUE_SOON_MAX_MS);
  if (params.dueAt.getTime() - params.now.getTime() <= dueSoonWindowMs) return "DUE_SOON";
  return "ON_TRACK";
}

export interface SlaPolicyRow {
  entity_type: string;
  event_type: string;
  priority: string | null;
  target_duration: number;
  duration_unit: SlaDurationUnit;
  is_active: boolean;
}

/** Picks the best-matching active policy: an exact priority match wins over a priority-agnostic (null) row. */
export function selectSlaPolicy(policies: SlaPolicyRow[], entityType: string, eventType: string, priority: string | null): SlaPolicyRow | null {
  const candidates = policies.filter((p) => p.is_active && p.entity_type === entityType && p.event_type === eventType);
  return candidates.find((p) => p.priority === priority) ?? candidates.find((p) => p.priority === null) ?? null;
}

export async function loadBusinessCalendar(supabase: TenantContext["supabase"], tenantId: string): Promise<BusinessCalendar> {
  const { data, error } = await supabase.from("business_calendars").select("id, timezone, working_days, business_hours").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle();
  if (error) throw error;
  if (!data) {
    // Same default the tenant-provisioning trigger seeds — never leaves SLA
    // math unable to run just because a calendar row is somehow missing.
    return { timezone: "Asia/Tokyo", workingDays: [1, 2, 3, 4, 5], businessHours: { start: "09:00", end: "18:00" }, holidays: [] };
  }
  const { data: holidayRows } = await supabase.from("business_calendar_holidays").select("holiday_date").eq("tenant_id", tenantId).eq("business_calendar_id", data.id as string);
  return {
    timezone: data.timezone as string,
    workingDays: data.working_days as number[],
    businessHours: data.business_hours as { start: string; end: string },
    holidays: (holidayRows ?? []).map((h) => h.holiday_date as string),
  };
}

export async function loadSlaPolicies(supabase: TenantContext["supabase"], tenantId: string): Promise<SlaPolicyRow[]> {
  const { data, error } = await supabase.from("sla_policies").select("entity_type, event_type, priority, target_duration, duration_unit, is_active").eq("tenant_id", tenantId).eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as SlaPolicyRow[];
}

/**
 * Computes an SLA due date for a new tracked event (spec §61-64) — fixed at
 * this moment, per `sla_due_at` being a snapshot: it must never silently
 * change if the tenant's calendar config changes later (a config change
 * only affects SLAs computed after that point). Returns null when no
 * matching policy exists — callers must treat that as "no SLA applies",
 * never fabricate a default deadline.
 */
export async function computeSlaForEvent(
  ctx: { supabase: TenantContext["supabase"]; tenantId: string },
  params: { entityType: string; eventType: string; priority?: string | null; startAt: Date }
): Promise<{ dueAt: Date; policy: SlaPolicyRow } | null> {
  const [calendar, policies] = await Promise.all([loadBusinessCalendar(ctx.supabase, ctx.tenantId), loadSlaPolicies(ctx.supabase, ctx.tenantId)]);
  const policy = selectSlaPolicy(policies, params.entityType, params.eventType, params.priority ?? null);
  if (!policy) return null;
  const dueAt = computeSlaDueAt(params.startAt, policy.target_duration, policy.duration_unit, calendar);
  return { dueAt, policy };
}
