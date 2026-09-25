import type { SupabaseServerClient } from "@/lib/server/tenant";
import { fetchWithRetry } from "@/lib/integrations/httpRetry";
import { getValidAccessToken, type IntegrationConnectionRow } from "@/lib/integrations/tokenStore";
import { SimulatedCalendarConnector, type CalendarConnector, type CalendarEventInput, type CalendarEventResult, type CalendarSlot } from "@/lib/sales/calendarConnector";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export class CalendarConflictError extends Error {}

/**
 * Real Google Calendar connector (spec §22-24) behind the exact same
 * CalendarConnector interface as SimulatedCalendarConnector.
 *
 * `proposeSlots()` stays the same synchronous, deterministic business-hours
 * heuristic as the Simulated connector rather than a live free/busy query —
 * the CalendarConnector interface (fixed since Phase 4, never broken by
 * this phase) requires a synchronous return, and a real free/busy check is
 * fundamentally async. This is a documented, honest scope limit (see README
 * Known Limitations). The actual safety property the spec cares about — "AI
 * never confirms a meeting alone" and no silent double-booking — is still
 * preserved end to end: a human always picks the slot
 * (`/api/meetings/[id]/select-time`), and `createEvent()` below performs a
 * live conflict check via `freeBusy.query` immediately before inserting,
 * refusing to book over an existing event even though the candidates it was
 * chosen from were heuristic.
 */
export class GoogleCalendarConnector implements CalendarConnector {
  readonly provider = "google_calendar";
  readonly isReal = true;
  private readonly heuristic = new SimulatedCalendarConnector();

  constructor(
    private readonly supabase: SupabaseServerClient,
    private readonly connection: IntegrationConnectionRow
  ) {}

  proposeSlots(seed: string, count: number, durationMinutes: number): CalendarSlot[] {
    return this.heuristic.proposeSlots(seed, count, durationMinutes);
  }

  private async authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const accessToken = await getValidAccessToken(this.supabase, this.connection);
    return fetchWithRetry(`${CALENDAR_API_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
    const freeBusyRes = await this.authorizedFetch("/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: input.start, timeMax: input.end, items: [{ id: "primary" }] }),
    });
    if (!freeBusyRes.ok) throw new Error(`Google Calendar freeBusy check failed: ${freeBusyRes.status}`);
    const freeBusy = (await freeBusyRes.json()) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };
    const busy = freeBusy.calendars?.primary?.busy ?? [];
    if (busy.length > 0) {
      throw new CalendarConflictError("The selected time is no longer free on this Google Calendar — ask the human to pick a different slot.");
    }

    const res = await this.authorizedFetch("/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify({
        summary: input.title,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        attendees: input.attendees.map((email) => ({ email })),
      }),
    });
    if (!res.ok) throw new Error(`Google Calendar createEvent failed: ${res.status}`);
    const data = (await res.json()) as { id: string; hangoutLink?: string };
    return { provider: this.provider, eventId: data.id, meetingUrl: data.hangoutLink ?? null };
  }
}
