import { afterEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { getCalendarConnector, SimulatedCalendarConnector } from "@/lib/sales/calendarConnector";

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

describe("getCalendarConnector (real-vs-simulated fallback)", () => {
  const originalClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  afterEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = originalClientId;
  });

  it("returns the Simulated connector when no ctx is given (e.g. automatic slot-proposal graph steps)", async () => {
    const connector = await getCalendarConnector();
    expect(connector.isReal).toBe(false);
  });

  it("returns the Simulated connector when not configured/connected", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const fake = new FakeSupabase();
    const connector = await getCalendarConnector({ supabase: fake as unknown as never, tenantId: "t1", userId: "u1" });
    expect(connector.isReal).toBe(false);
  });

  it("returns the real GoogleCalendarConnector when configured and connected", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "configured";
    const fake = new FakeSupabase();
    fake.table("integration_connections").push({ id: "c1", tenant_id: "t1", user_id: "u1", provider: "google", status: "connected" });
    const connector = await getCalendarConnector({ supabase: fake as unknown as never, tenantId: "t1", userId: "u1" });
    expect(connector.isReal).toBe(true);
    expect(connector.provider).toBe("google_calendar");
  });
});
