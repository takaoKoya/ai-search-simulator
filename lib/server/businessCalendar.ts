/**
 * Business-Time-aware SLA calculation (spec §58-64) — "not a naive 24-hour
 * diff": due dates for `business_hours`/`business_days` targets only tick
 * forward during a tenant's configured working days/hours, skipping
 * weekends and holidays. Uses `Intl.DateTimeFormat` (built into Node, no
 * date library dependency) to read wall-clock time in the calendar's own
 * IANA timezone — never assumes UTC or the server's local timezone.
 */

export interface BusinessCalendar {
  timezone: string; // IANA, e.g. "Asia/Tokyo"
  workingDays: number[]; // 0=Sun..6=Sat
  businessHours: { start: string; end: string }; // "09:00".."18:00", 24h
  holidays: string[]; // "YYYY-MM-DD" dates, in the calendar's own timezone
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  // hour12:false renders midnight as "24"; normalize to 0 for a usable minute-of-day value.
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday],
  };
}

/** Constructs the instant corresponding to a given wall-clock date+time in `timeZone`. */
function zonedTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  // A UTC guess, then corrected by the actual offset this timezone has at
  // that guess — handles timezones with non-whole-hour or DST offsets
  // without needing a timezone database library.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const guessed = getZonedParts(new Date(utcGuess), timeZone);
  const guessedAsUtc = Date.UTC(guessed.year, guessed.month - 1, guessed.day, guessed.hour, guessed.minute);
  const offsetMs = guessedAsUtc - utcGuess;
  return new Date(utcGuess - offsetMs);
}

function parseHHMM(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

function isHoliday(parts: ZonedParts, holidays: string[]): boolean {
  const dateStr = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return holidays.includes(dateStr);
}

export function isBusinessDay(date: Date, calendar: BusinessCalendar): boolean {
  const parts = getZonedParts(date, calendar.timezone);
  return calendar.workingDays.includes(parts.weekday) && !isHoliday(parts, calendar.holidays);
}

function nextDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  // Using UTC noon avoids any DST-adjacent midnight ambiguity while doing
  // pure calendar-date arithmetic (no timezone conversion happening here).
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  d.setUTCDate(d.getUTCDate() + 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Adds `hours` of business time to `startAt` — only counting time within
 * configured working days and business hours, in the calendar's own
 * timezone. Also used for `business_days` targets (see computeSlaDueAt):
 * "N business days" is defined as N × (a full business day's hours) of
 * business time from now, so it composes on the exact same algorithm
 * rather than a separate, ambiguous calendar-day-boundary rule.
 */
export function addBusinessHours(startAt: Date, hours: number, calendar: BusinessCalendar): Date {
  const { hour: startHour, minute: startMinute } = parseHHMM(calendar.businessHours.start);
  const { hour: endHour, minute: endMinute } = parseHHMM(calendar.businessHours.end);
  const dailyMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (dailyMinutes <= 0) throw new Error("business_hours.end must be after business_hours.start");

  let remainingMinutes = hours * 60;
  let parts = getZonedParts(startAt, calendar.timezone);

  // Snap forward to the start of the next valid business window if we are
  // not currently inside one.
  for (;;) {
    if (calendar.workingDays.includes(parts.weekday) && !isHoliday(parts, calendar.holidays)) {
      const minuteOfDay = parts.hour * 60 + parts.minute;
      if (minuteOfDay < startHour * 60 + startMinute) {
        parts = { ...parts, hour: startHour, minute: startMinute };
        break;
      }
      if (minuteOfDay < endHour * 60 + endMinute) {
        break; // already inside today's business window
      }
    }
    const next = nextDay(parts.year, parts.month, parts.day);
    parts = { ...next, hour: startHour, minute: startMinute, weekday: getWeekdayOf(next) };
  }

  for (;;) {
    const minuteOfDay = parts.hour * 60 + parts.minute;
    const minutesLeftToday = endHour * 60 + endMinute - minuteOfDay;
    if (remainingMinutes <= minutesLeftToday) {
      const totalMinute = minuteOfDay + remainingMinutes;
      return zonedTimeToInstant(parts.year, parts.month, parts.day, Math.floor(totalMinute / 60), totalMinute % 60, calendar.timezone);
    }
    remainingMinutes -= minutesLeftToday;

    // Advance to the next business day's opening time.
    let next = nextDay(parts.year, parts.month, parts.day);
    let nextWeekday = getWeekdayOf(next);
    while (!calendar.workingDays.includes(nextWeekday) || calendar.holidays.includes(dateStr(next))) {
      next = nextDay(next.year, next.month, next.day);
      nextWeekday = getWeekdayOf(next);
    }
    parts = { ...next, hour: startHour, minute: startMinute, weekday: nextWeekday };
  }
}

function dateStr(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function getWeekdayOf(d: { year: number; month: number; day: number }): number {
  // Pure calendar-date weekday (UTC), independent of any timezone
  // conversion — the y/m/d here are already the calendar's own local date.
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export type SlaDurationUnit = "hours" | "business_hours" | "days" | "business_days";

export function computeSlaDueAt(startAt: Date, targetDuration: number, durationUnit: SlaDurationUnit, calendar: BusinessCalendar): Date {
  const dailyBusinessHours = businessHoursPerDay(calendar);
  switch (durationUnit) {
    case "hours":
      return new Date(startAt.getTime() + targetDuration * 3600_000);
    case "days":
      return new Date(startAt.getTime() + targetDuration * 86_400_000);
    case "business_hours":
      return addBusinessHours(startAt, targetDuration, calendar);
    case "business_days":
      return addBusinessHours(startAt, targetDuration * dailyBusinessHours, calendar);
    default:
      throw new Error(`Unknown SLA duration unit: ${durationUnit}`);
  }
}

function businessHoursPerDay(calendar: BusinessCalendar): number {
  const { hour: startHour, minute: startMinute } = parseHHMM(calendar.businessHours.start);
  const { hour: endHour, minute: endMinute } = parseHHMM(calendar.businessHours.end);
  return (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
}
