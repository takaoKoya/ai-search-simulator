import { describe, expect, it } from "vitest";
import { formatDateOnly, resolvePeriod } from "./period";

const now = new Date("2026-10-13T03:00:00Z"); // 12:00 JST on 2026-10-13

function range(input: Parameters<typeof resolvePeriod>[0]) {
  const r = resolvePeriod(input, now);
  if (!r.ok) throw new Error(r.error);
  return [r.period.range, formatDateOnly(r.period.start), formatDateOnly(r.period.end)];
}

describe("resolvePeriod", () => {
  it("resolves presets in JST, inclusive of today", () => {
    expect(range({})).toEqual(["all", "", ""]);
    expect(range({ range: "today" })).toEqual(["today", "2026-10-13", "2026-10-13"]);
    expect(range({ range: "7d" })).toEqual(["7d", "2026-10-07", "2026-10-13"]);
    expect(range({ range: "30d" })).toEqual(["30d", "2026-09-14", "2026-10-13"]);
  });
  it("uses JST for 'today' even when UTC is still the previous day", () => {
    const r = resolvePeriod({ range: "today" }, new Date("2026-10-12T16:00:00Z"));
    expect(r.ok && formatDateOnly(r.period.start)).toBe("2026-10-13");
  });
  it("treats bare dates as a custom range and allows open-ended ranges", () => {
    expect(range({ startDate: "2026-10-01", endDate: "2026-10-05" })).toEqual(["custom", "2026-10-01", "2026-10-05"]);
    expect(range({ range: "custom", startDate: "2026-10-01" })).toEqual(["custom", "2026-10-01", ""]);
  });
  it("rejects bad input", () => {
    expect(resolvePeriod({ range: "yearly" }, now).ok).toBe(false);
    expect(resolvePeriod({ range: "custom" }, now).ok).toBe(false);
    expect(resolvePeriod({ startDate: "2026-02-31" }, now).ok).toBe(false);
    expect(resolvePeriod({ startDate: "10/01" }, now).ok).toBe(false);
    expect(resolvePeriod({ startDate: "2026-10-05", endDate: "2026-10-01" }, now).ok).toBe(false);
  });
});
