import { describe, expect, it } from "vitest";
import { computeSlaStatus, selectSlaPolicy, type SlaPolicyRow } from "@/lib/server/slaEngine";

describe("computeSlaStatus", () => {
  const startAt = new Date("2026-01-05T00:00:00Z");
  const dueAt = new Date("2026-01-05T04:00:00Z"); // 4-hour window

  it("is COMPLETED once resolved, regardless of timing", () => {
    expect(computeSlaStatus({ dueAt, startAt, now: new Date("2026-01-10T00:00:00Z"), resolved: true })).toBe("COMPLETED");
  });

  it("is ON_TRACK well before the due-soon window", () => {
    const now = new Date("2026-01-05T01:00:00Z"); // 1h in, 3h left of a 4h window
    expect(computeSlaStatus({ dueAt, startAt, now, resolved: false })).toBe("ON_TRACK");
  });

  it("is DUE_SOON inside the last 25% of the window", () => {
    const now = new Date("2026-01-05T03:10:00Z"); // 50 min left of a 4h (240 min) window; 25% = 60 min
    expect(computeSlaStatus({ dueAt, startAt, now, resolved: false })).toBe("DUE_SOON");
  });

  it("is BREACHED once now has passed dueAt", () => {
    const now = new Date("2026-01-05T04:00:01Z");
    expect(computeSlaStatus({ dueAt, startAt, now, resolved: false })).toBe("BREACHED");
  });

  it("caps the DUE_SOON window at 4 business hours even for a very long SLA", () => {
    const longStart = new Date("2026-01-01T00:00:00Z");
    const longDue = new Date("2026-02-01T00:00:00Z"); // ~31 days
    // 5 hours before due (> the 4h cap) should still be ON_TRACK.
    const now = new Date("2026-01-31T19:00:00Z");
    expect(computeSlaStatus({ dueAt: longDue, startAt: longStart, now, resolved: false })).toBe("ON_TRACK");
    // 3 hours before due (< the 4h cap) should be DUE_SOON.
    const nowCloser = new Date("2026-01-31T21:00:00Z");
    expect(computeSlaStatus({ dueAt: longDue, startAt: longStart, now: nowCloser, resolved: false })).toBe("DUE_SOON");
  });
});

describe("selectSlaPolicy", () => {
  const POLICIES: SlaPolicyRow[] = [
    { entity_type: "sales_message", event_type: "positive_reply", priority: "P1", target_duration: 4, duration_unit: "business_hours", is_active: true },
    { entity_type: "sales_message", event_type: "meeting_request", priority: "P0", target_duration: 2, duration_unit: "business_hours", is_active: true },
    { entity_type: "approval_request", event_type: "proposal_revision", priority: null, target_duration: 1, duration_unit: "business_days", is_active: true },
    { entity_type: "approval_request", event_type: "contract_high_risk", priority: null, target_duration: 4, duration_unit: "business_hours", is_active: false },
  ];

  it("matches on entity_type + event_type + exact priority", () => {
    const match = selectSlaPolicy(POLICIES, "sales_message", "positive_reply", "P1");
    expect(match?.target_duration).toBe(4);
  });

  it("falls back to a priority-agnostic (null) policy when no exact priority match exists", () => {
    const match = selectSlaPolicy(POLICIES, "approval_request", "proposal_revision", "P2");
    expect(match?.duration_unit).toBe("business_days");
  });

  it("ignores inactive policies", () => {
    expect(selectSlaPolicy(POLICIES, "approval_request", "contract_high_risk", null)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(selectSlaPolicy(POLICIES, "sales_message", "unknown_event", null)).toBeNull();
  });
});
