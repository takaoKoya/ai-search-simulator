import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/lib/integrations/crypto";
import { CalendarConflictError, GoogleCalendarConnector } from "@/lib/integrations/googleCalendarConnector";
import type { IntegrationConnectionRow } from "@/lib/integrations/tokenStore";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "3".repeat(64);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
});

function makeConnection(): IntegrationConnectionRow {
  return {
    id: "conn-1",
    tenant_id: "t1",
    user_id: "u1",
    provider: "google",
    status: "connected",
    scopes: [],
    connected_email: "sales@example.com",
    encrypted_access_token: encryptToken("live-access-token"),
    encrypted_refresh_token: encryptToken("live-refresh-token"),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe("GoogleCalendarConnector", () => {
  it("proposeSlots stays a synchronous, deterministic heuristic (no network call)", () => {
    const connector = new GoogleCalendarConnector({} as never, makeConnection());
    const slots = connector.proposeSlots("seed-1", 3, 45);
    expect(slots).toHaveLength(3);
    expect(slots[0].start < slots[0].end).toBe(true);
  });

  describe("createEvent", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("checks freeBusy before creating, then POSTs to Calendar's official events endpoint", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ calendars: { primary: { busy: [] } } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "evt-1", hangoutLink: "https://meet.google.com/abc" }) });

      const connector = new GoogleCalendarConnector({} as never, makeConnection());
      const result = await connector.createEvent({ title: "商談", start: "2026-01-05T01:00:00Z", end: "2026-01-05T01:45:00Z", attendees: ["client@example.com"] });

      expect(result).toEqual({ provider: "google_calendar", eventId: "evt-1", meetingUrl: "https://meet.google.com/abc" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [freeBusyUrl] = fetchMock.mock.calls[0];
      expect(freeBusyUrl).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
      const [eventsUrl] = fetchMock.mock.calls[1];
      expect(eventsUrl).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    });

    it("refuses to double-book: throws CalendarConflictError when freeBusy reports a conflict, without ever calling events.insert", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ calendars: { primary: { busy: [{ start: "2026-01-05T01:00:00Z", end: "2026-01-05T01:45:00Z" }] } } }) });

      const connector = new GoogleCalendarConnector({} as never, makeConnection());
      await expect(connector.createEvent({ title: "商談", start: "2026-01-05T01:00:00Z", end: "2026-01-05T01:45:00Z", attendees: [] })).rejects.toThrow(CalendarConflictError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
