import { describe, expect, it } from "vitest";
import { computeRenewalDueStatus, computeRenewalHealth } from "@/lib/server/renewalRisk";

describe("computeRenewalDueStatus — Test Case D (90 days before end)", () => {
  it("enters UPCOMING once within the earliest trigger window", () => {
    const today = new Date("2026-01-01T00:00:00Z");
    const endDate = new Date("2026-04-01T00:00:00Z"); // 90 days out
    const result = computeRenewalDueStatus(endDate, today, [90, 60, 30], 30);
    expect(result.status).toBe("UPCOMING");
    expect(result.daysUntilEnd).toBe(90);
    expect(result.noticeDeadline?.toISOString()).toBe(new Date("2026-03-02T00:00:00Z").toISOString());
  });

  it("stays NOT_DUE well before the trigger window", () => {
    const today = new Date("2026-01-01T00:00:00Z");
    const endDate = new Date("2026-12-01T00:00:00Z");
    expect(computeRenewalDueStatus(endDate, today).status).toBe("NOT_DUE");
  });
});

describe("computeRenewalHealth", () => {
  it("returns GREEN with an explanation when nothing is wrong", () => {
    const result = computeRenewalHealth({
      kpiAchievementRatio: 0.9,
      openCriticalIssues: 0,
      missedMeetingsCount: 0,
      clientSentiment: "POSITIVE",
      paymentOverdue: false,
      marginRate: 0.4,
    });
    expect(result.level).toBe("GREEN");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("is never a black box — RED always carries reasons naming the specific factors", () => {
    const result = computeRenewalHealth({
      kpiAchievementRatio: 0.3,
      openCriticalIssues: 2,
      missedMeetingsCount: 2,
      clientSentiment: "NEGATIVE",
      paymentOverdue: false,
      marginRate: null,
    });
    expect(result.level).toBe("RED");
    expect(result.reasons.some((r) => r.includes("KPI達成率"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("Critical Issue"))).toBe(true);
  });

  it("reaches YELLOW for a single moderate risk factor", () => {
    const result = computeRenewalHealth({
      kpiAchievementRatio: 0.6,
      openCriticalIssues: 0,
      missedMeetingsCount: 0,
      clientSentiment: "NEUTRAL",
      paymentOverdue: false,
      marginRate: null,
    });
    expect(result.level).toBe("YELLOW");
  });
});
