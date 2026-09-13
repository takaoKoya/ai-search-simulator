/**
 * Calendar connector abstraction (spec §22-24).
 *
 * Same honesty constraint as `emailConnector.ts`: no real Google Calendar
 * integration exists in this repository. `SimulatedCalendarConnector`
 * deterministically proposes business-hours candidate slots (weekdays only,
 * 10:00/14:00/16:00 JST-equivalent) and fabricates a calendar_event_id
 * without ever calling an external API. A real Calendar connector behind
 * this same interface is a Phase 5 item.
 */

export interface CalendarSlot {
  start: string; // ISO
  end: string; // ISO
}

export interface CalendarEventInput {
  title: string;
  start: string;
  end: string;
  attendees: string[];
}

export interface CalendarEventResult {
  provider: string;
  eventId: string;
  meetingUrl: string | null;
}

export interface CalendarConnector {
  readonly provider: string;
  readonly isReal: boolean;
  proposeSlots(seed: string, count: number, durationMinutes: number): CalendarSlot[];
  createEvent(input: CalendarEventInput): Promise<CalendarEventResult>;
}

function seededOffset(seed: string, mod: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % mod;
}

function seededId(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

const BUSINESS_HOURS = [10, 14, 16];

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export class SimulatedCalendarConnector implements CalendarConnector {
  readonly provider = "simulated_calendar";
  readonly isReal = false;

  proposeSlots(seed: string, count: number, durationMinutes: number): CalendarSlot[] {
    const slots: CalendarSlot[] = [];
    const startOffsetDays = 1 + seededOffset(seed, 3); // 1-3 business days out
    let dayCursor = new Date(Date.now());
    dayCursor.setUTCHours(0, 0, 0, 0);
    dayCursor.setUTCDate(dayCursor.getUTCDate() + startOffsetDays);

    let hourIndex = seededOffset(seed + "hour", BUSINESS_HOURS.length);
    while (slots.length < count) {
      if (!isWeekend(dayCursor)) {
        const hour = BUSINESS_HOURS[hourIndex % BUSINESS_HOURS.length];
        const start = new Date(dayCursor);
        start.setUTCHours(hour, 0, 0, 0);
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        slots.push({ start: start.toISOString(), end: end.toISOString() });
        hourIndex += 1;
        if (hourIndex % BUSINESS_HOURS.length === 0) {
          dayCursor = new Date(dayCursor.getTime() + 24 * 3600_000);
        }
      } else {
        dayCursor = new Date(dayCursor.getTime() + 24 * 3600_000);
      }
    }
    return slots;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
    return {
      provider: this.provider,
      eventId: `evt_${seededId(input.title + input.start)}`,
      meetingUrl: `https://meet.example.invalid/${seededId(input.start)}`,
    };
  }
}

export function getCalendarConnector(): CalendarConnector {
  return new SimulatedCalendarConnector();
}
