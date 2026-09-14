import { describe, expect, it } from "vitest";
import { addBusinessHours, computeSlaDueAt, isBusinessDay, type BusinessCalendar } from "@/lib/server/businessCalendar";

// Asia/Tokyo has no DST — a fixed UTC+9 offset year-round, which keeps
// these expected UTC instants simple to hand-verify.
// 2026-01-05 = Monday, 2026-01-09 = Friday, 2026-01-10/11 = Sat/Sun, 2026-01-12 = Monday.
const CALENDAR: BusinessCalendar = {
  timezone: "Asia/Tokyo",
  workingDays: [1, 2, 3, 4, 5],
  businessHours: { start: "09:00", end: "18:00" },
  holidays: [],
};

function jst(iso: string): Date {
  // `iso` is a JST wall-clock time written as if it were UTC; convert by
  // subtracting the +9h offset to get the real UTC instant.
  return new Date(new Date(iso).getTime() - 9 * 3600_000);
}

describe("isBusinessDay", () => {
  it("is true for a weekday business hour", () => {
    expect(isBusinessDay(jst("2026-01-05T09:00:00Z"), CALENDAR)).toBe(true); // Monday
  });

  it("is false for a Saturday", () => {
    expect(isBusinessDay(jst("2026-01-10T09:00:00Z"), CALENDAR)).toBe(false);
  });

  it("is false for a configured holiday even if it is a weekday", () => {
    const calendarWithHoliday = { ...CALENDAR, holidays: ["2026-01-05"] };
    expect(isBusinessDay(jst("2026-01-05T09:00:00Z"), calendarWithHoliday)).toBe(false);
  });
});

describe("addBusinessHours", () => {
  it("adds hours within the same business day", () => {
    const result = addBusinessHours(jst("2026-01-05T10:00:00Z"), 2, CALENDAR);
    expect(result.getTime()).toBe(jst("2026-01-05T12:00:00Z").getTime());
  });

  it("spills over to the next business day when it runs past closing time", () => {
    const result = addBusinessHours(jst("2026-01-05T17:00:00Z"), 2, CALENDAR); // Monday 17:00 + 2h
    expect(result.getTime()).toBe(jst("2026-01-06T10:00:00Z").getTime()); // Tuesday 10:00
  });

  it("skips the weekend entirely", () => {
    const result = addBusinessHours(jst("2026-01-09T17:00:00Z"), 2, CALENDAR); // Friday 17:00 + 2h
    expect(result.getTime()).toBe(jst("2026-01-12T10:00:00Z").getTime()); // Monday 10:00
  });

  it("snaps a start time after closing to the next business day's opening", () => {
    const result = addBusinessHours(jst("2026-01-05T20:00:00Z"), 1, CALENDAR); // Monday 20:00 (after hours)
    expect(result.getTime()).toBe(jst("2026-01-06T10:00:00Z").getTime()); // Tuesday 10:00
  });

  it("snaps a start time on a non-business day to the next business day's opening", () => {
    const result = addBusinessHours(jst("2026-01-10T12:00:00Z"), 1, CALENDAR); // Saturday
    expect(result.getTime()).toBe(jst("2026-01-12T10:00:00Z").getTime()); // Monday 10:00
  });

  it("skips a holiday that falls in the middle of the window", () => {
    const calendarWithHoliday = { ...CALENDAR, holidays: ["2026-01-06"] }; // Tuesday is a holiday
    const result = addBusinessHours(jst("2026-01-05T17:00:00Z"), 2, calendarWithHoliday); // Monday 17:00 + 2h
    expect(result.getTime()).toBe(jst("2026-01-07T10:00:00Z").getTime()); // Wednesday 10:00
  });
});

describe("computeSlaDueAt", () => {
  it("hours: adds naive wall-clock hours, ignoring business hours", () => {
    const result = computeSlaDueAt(jst("2026-01-09T17:00:00Z"), 3, "hours", CALENDAR); // Friday 17:00 + 3h
    expect(result.getTime()).toBe(jst("2026-01-09T20:00:00Z").getTime()); // Friday 20:00, not business-aware
  });

  it("days: adds naive 24h days, ignoring weekends", () => {
    const result = computeSlaDueAt(jst("2026-01-09T10:00:00Z"), 2, "days", CALENDAR); // Friday + 2 days
    expect(result.getTime()).toBe(jst("2026-01-11T10:00:00Z").getTime()); // Sunday — never skipped for plain "days"
  });

  it("business_hours: delegates to addBusinessHours", () => {
    const result = computeSlaDueAt(jst("2026-01-05T10:00:00Z"), 2, "business_hours", CALENDAR);
    expect(result.getTime()).toBe(jst("2026-01-05T12:00:00Z").getTime());
  });

  it("business_days: 1 business day == one full business day's worth of business hours", () => {
    const result = computeSlaDueAt(jst("2026-01-05T09:00:00Z"), 1, "business_days", CALENDAR); // Monday 09:00 + 1 business day (9h)
    expect(result.getTime()).toBe(jst("2026-01-05T18:00:00Z").getTime()); // Monday 18:00 (end of business hours)
  });
});
