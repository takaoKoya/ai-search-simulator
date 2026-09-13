import { describe, expect, it } from "vitest";
import { SimulatedCalendarConnector } from "@/lib/sales/calendarConnector";

describe("SimulatedCalendarConnector", () => {
  it("proposes only weekday business-hours slots", () => {
    const connector = new SimulatedCalendarConnector();
    const slots = connector.proposeSlots("seed-a", 5, 60);
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      const start = new Date(slot.start);
      expect(start.getUTCDay()).not.toBe(0);
      expect(start.getUTCDay()).not.toBe(6);
      expect(new Date(slot.end).getTime() - start.getTime()).toBe(60 * 60_000);
    }
  });

  it("is deterministic for the same seed", () => {
    const connector = new SimulatedCalendarConnector();
    const a = connector.proposeSlots("company-x", 3, 30);
    const b = connector.proposeSlots("company-x", 3, 30);
    expect(a).toEqual(b);
  });

  it("createEvent never claims to be real and returns a stable event id", async () => {
    const connector = new SimulatedCalendarConnector();
    expect(connector.isReal).toBe(false);
    const input = { title: "Discovery Call", start: "2026-10-01T01:00:00.000Z", end: "2026-10-01T02:00:00.000Z", attendees: ["a@example.com"] };
    const a = await connector.createEvent(input);
    const b = await connector.createEvent(input);
    expect(a.eventId).toBe(b.eventId);
  });
});
